# --- Your current public IP, so SSH isn't open to the whole internet by default ---
data "http" "my_ip" {
  count = var.ssh_allowed_cidr == "" ? 1 : 0
  url   = "https://checkip.amazonaws.com"
}

locals {
  ssh_cidr = var.ssh_allowed_cidr != "" ? var.ssh_allowed_cidr : "${chomp(data.http.my_ip[0].response_body)}/32"
}

# --- Ubuntu 24.04 LTS (Canonical's own AMI) ---
# Chosen over Amazon Linux 2023 because Caddy and NodeSource both publish
# official, well-tested apt repos for Ubuntu — the bootstrap script mirrors
# their own install docs exactly, rather than adapting dnf/COPR instructions
# that aren't really written for AL2023.
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# --- A dedicated SSH key, generated locally and registered with AWS ---
resource "tls_private_key" "deploy" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "deploy" {
  key_name   = "${var.project_name}-key"
  public_key = tls_private_key.deploy.public_key_openssh
}

resource "local_sensitive_file" "private_key" {
  content         = tls_private_key.deploy.private_key_pem
  filename        = "${path.module}/${var.project_name}-key.pem"
  file_permission = "0600"
}

# --- Firewall: SSH from you only, HTTP/HTTPS from anywhere ---
resource "aws_security_group" "app" {
  name        = "${var.project_name}-sg"
  description = "SSH from the operator IP; HTTP/HTTPS from anywhere for Caddy and the API"

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [local.ssh_cidr]
  }

  ingress {
    description = "HTTP (redirects to HTTPS via Caddy; also serves ACME challenges)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS (API + WebSocket, reverse-proxied by Caddy)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-sg" }
}

# --- The instance itself ---
resource "aws_instance" "app" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = aws_key_pair.deploy.key_name
  vpc_security_group_ids = [aws_security_group.app.id]
  user_data              = file("${path.module}/user_data.sh")

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
  }

  tags = { Name = var.project_name }
}

# --- A stable public IP that survives instance stop/start ---
resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"
  tags     = { Name = "${var.project_name}-eip" }
}
