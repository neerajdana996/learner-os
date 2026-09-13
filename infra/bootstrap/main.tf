# One-time: the S3 bucket every other stack keeps its Terraform state in.
#
# Its own stack, with local state, because a backend cannot point at a bucket
# that does not exist yet. Run once per AWS account; nothing here should change
# afterwards, and the bucket refuses to be destroyed by accident.
#
#   cd infra/bootstrap && terraform init && terraform apply
terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "project_name" {
  type    = string
  default = "learnos"
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = { Project = var.project_name, ManagedBy = "terraform", Stack = "bootstrap" }
  }
}

data "aws_caller_identity" "current" {}

# The account id keeps the name globally unique without anyone inventing one.
resource "aws_s3_bucket" "state" {
  bucket = "${var.project_name}-tfstate-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

# Versioned, so a bad apply that corrupts state can be rolled back to the
# previous object rather than rebuilt from memory.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "state_bucket" {
  description = "Pass to the prod stack: terraform init -backend-config=\"bucket=<this>\""
  value       = aws_s3_bucket.state.bucket
}
