terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # State in S3 with native lockfile locking (Terraform >= 1.10), so no
  # DynamoDB table. The bucket name is not written here because it carries the
  # account id; pass it at init:
  #
  #   terraform init -backend-config="bucket=learnos-tfstate-<account-id>"
  backend "s3" {
    key          = "prod/coolify-host.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = { Project = var.project_name, ManagedBy = "terraform", Stack = "prod" }
  }
}
