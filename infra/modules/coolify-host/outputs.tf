output "public_ip" {
  description = "The Elastic IP. DNS points here."
  value       = aws_eip.host.public_ip
}

output "instance_id" {
  description = "For SSM sessions and port-forwards."
  value       = aws_instance.host.id
}

output "backup_bucket" {
  description = "Where Coolify's scheduled database backups go."
  value       = aws_s3_bucket.backups.bucket
}
