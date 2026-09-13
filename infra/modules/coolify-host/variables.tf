variable "project_name" {
  description = "Prefix used to name every resource."
  type        = string
}

variable "instance_type" {
  description = "An arm64 (Graviton) type — the AMI is arm64. t4g.large is 2 vCPU / 8 GiB."
  type        = string
  default     = "t4g.large"

  validation {
    condition     = can(regex("^[a-z0-9]+g[a-z]*\\.", var.instance_type))
    error_message = "instance_type must be a Graviton (arm64) type such as t4g.large; the AMI is arm64."
  }
}

variable "root_volume_gb" {
  description = "Root gp3 volume. Holds Docker images, Postgres data and local backups before upload."
  type        = number
  default     = 40
}

variable "swap_gb" {
  description = "Swap file size. Headroom for a build spike, not capacity."
  type        = number
  default     = 2
}

variable "backup_retention_days" {
  description = "Days a backup object is kept in S3."
  type        = number
  default     = 30
}

variable "snapshot_retention_count" {
  description = "Daily EBS snapshots kept."
  type        = number
  default     = 7
}
