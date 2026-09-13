variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "project_name" {
  type    = string
  default = "learnos"
}

variable "domain_name" {
  type    = string
  default = "coldrecall.info"
}

variable "instance_type" {
  description = "t4g.large: 2 vCPU / 8 GiB, ~$33/mo on-demand in ap-south-1."
  type        = string
  default     = "t4g.large"
}

variable "root_volume_gb" {
  type    = number
  default = 40
}

variable "alert_email" {
  description = "Receives budget alerts. Set in terraform.tfvars."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly gross spend the alerts are measured against. ~$42 is the expected all-in cost."
  type        = number
  default     = 45
}

variable "cutover" {
  description = <<-EOT
    false: the zone mirrors today's live records (site on Vercel, api on the
    legacy EC2), so moving BigRock's nameservers to Route 53 changes nothing.
    true: the site and api point at the Coolify host. Flip only once the apps
    are deployed in Coolify and tested.
  EOT
  type        = bool
  default     = false
}

variable "legacy_web_ip" {
  description = "Where coldrecall.info and www point today (Vercel)."
  type        = string
  default     = "76.76.21.21"
}

variable "legacy_api_host" {
  description = "Where api.coldrecall.info points today (the t3.micro in the legacy stack)."
  type        = string
  default     = "ec2-13-200-206-246.ap-south-1.compute.amazonaws.com"
}
