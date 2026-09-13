# One machine running Coolify, and everything Coolify then runs on it: the web
# app, API, worker, Postgres and Redis (T-168).
#
# Terraform owns the machine; Coolify owns what runs on it. That line is the
# point of the split — an app deploy, a new database or a changed domain is a
# change in Coolify's dashboard, never a re-provision.

data "aws_caller_identity" "current" {}

# ARM (Graviton): the t4g family is roughly 20% cheaper than the equivalent
# x86 size, and every image this stack needs — Node, Postgres, Redis, Coolify
# itself — publishes arm64 builds.
data "aws_ami" "ubuntu_arm" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*"]
  }

  filter {
    name   = "architecture"
    values = ["arm64"]
  }
}

# --- Firewall: web traffic only ---
#
# No port 22. Shell access is SSM Session Manager, which needs no inbound port
# and no key file to lose — the previous stack generated an SSH key into the
# repo directory. Coolify's own dashboard (8000) is not exposed either: reach it
# through an SSM port-forward until it is served on its own HTTPS domain.
# Descriptions avoid apostrophes: AWS rejects them in security group text.
resource "aws_security_group" "host" {
  name        = "${var.project_name}-coolify-sg"
  description = "HTTP and HTTPS only. Shell access is SSM Session Manager."

  ingress {
    description      = "HTTP (ACME challenges; redirected to HTTPS by the Coolify proxy)"
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  ingress {
    description      = "HTTPS (web app, API and WebSocket, via the Coolify proxy)"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  # Direct database access, for working from a laptop. Opened only for the
  # addresses in var.database_access_cidrs; with the default empty list neither
  # rule exists. Both databases have generated passwords, but an open 5432 or
  # 6379 is scanned and brute-forced within hours, so keep the list narrow.
  dynamic "ingress" {
    for_each = length(var.database_access_cidrs) > 0 ? [5432, 6379] : []

    content {
      description = "Database port ${ingress.value} from allowed addresses only"
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = var.database_access_cidrs
    }
  }

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = { Name = "${var.project_name}-coolify-sg" }
}

# --- Backups: off the box, because the box is the single point of failure ---
resource "aws_s3_bucket" "backups" {
  bucket = "${var.project_name}-backups-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expire-old-backups"
    status = "Enabled"

    filter {}

    expiration {
      days = var.backup_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
}

# --- The machine's identity: SSM access and the backup bucket, nothing else ---
data "aws_iam_policy_document" "assume_ec2" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "host" {
  name               = "${var.project_name}-coolify-host"
  assume_role_policy = data.aws_iam_policy_document.assume_ec2.json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "backups" {
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.backups.arn]
  }

  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.backups.arn}/*"]
  }
}

resource "aws_iam_role_policy" "backups" {
  name   = "backups"
  role   = aws_iam_role.host.id
  policy = data.aws_iam_policy_document.backups.json
}

resource "aws_iam_instance_profile" "host" {
  name = "${var.project_name}-coolify-host"
  role = aws_iam_role.host.name
}

# --- The instance ---
resource "aws_instance" "host" {
  ami                    = data.aws_ami.ubuntu_arm.id
  instance_type          = var.instance_type
  iam_instance_profile   = aws_iam_instance_profile.host.name
  vpc_security_group_ids = [aws_security_group.host.id]
  user_data              = templatefile("${path.module}/user_data.sh.tftpl", { swap_gb = var.swap_gb })

  # IMDSv2 only: a request-forgery bug in anything on the box cannot read the
  # instance role's credentials through a plain GET.
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
    encrypted   = true
    # Picked up by the snapshot policy below.
    tags = { Name = "${var.project_name}-coolify-root", Backup = "daily" }
  }

  tags = { Name = "${var.project_name}-coolify" }

  lifecycle {
    # A newer Ubuntu AMI must never replace a running production box on the
    # next apply. Patch in place; replace deliberately.
    ignore_changes = [ami, user_data]
  }
}

# Associated separately so the address survives the instance being replaced:
# DNS points at this IP, not at the instance.
resource "aws_eip" "host" {
  domain = "vpc"
  tags   = { Name = "${var.project_name}-coolify-eip" }
}

resource "aws_eip_association" "host" {
  instance_id   = aws_instance.host.id
  allocation_id = aws_eip.host.id
}

# --- Daily disk snapshots, a second line behind the S3 database backups ---
data "aws_iam_policy_document" "assume_dlm" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["dlm.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "dlm" {
  name               = "${var.project_name}-dlm"
  assume_role_policy = data.aws_iam_policy_document.assume_dlm.json
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "daily" {
  description        = "${var.project_name} daily EBS snapshots"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { Backup = "daily" }

    schedule {
      name      = "daily"
      copy_tags = true

      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["21:30"] # 03:00 IST, the quietest hour for learners in India
      }

      retain_rule {
        count = var.snapshot_retention_count
      }
    }
  }
}
