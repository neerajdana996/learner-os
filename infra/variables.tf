variable "aws_region" {
  description = "AWS region for the instance."
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Prefix used to name/tag every resource."
  type        = string
  default     = "learnos"
}

variable "instance_type" {
  description = "EC2 instance type. t3.micro is Free-Tier eligible (750 hrs/mo for 12 months on a new account)."
  type        = string
  default     = "t3.micro"
}

variable "root_volume_gb" {
  description = "Root EBS volume size in GB. 30GB/mo of gp3 is within the Free Tier."
  type        = number
  default     = 20
}

variable "ssh_allowed_cidr" {
  description = "CIDR allowed to SSH in on port 22. Leave empty to auto-detect your current public IP at apply time."
  type        = string
  default     = ""
}
