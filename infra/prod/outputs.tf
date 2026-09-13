output "public_ip" {
  description = "The Coolify host's Elastic IP."
  value       = module.host.public_ip
}

output "name_servers" {
  description = "Set these as the nameservers for coldrecall.info in BigRock. Safe before cutover: the zone mirrors today's live records."
  value       = module.dns.name_servers
}

output "shell" {
  description = "A shell on the host, through SSM (needs the Session Manager plugin for the AWS CLI)."
  value       = "aws ssm start-session --region ${var.aws_region} --target ${module.host.instance_id}"
}

output "coolify_dashboard_tunnel" {
  description = "Forward Coolify's dashboard to http://localhost:8000, until it is served on its own HTTPS domain."
  value       = "aws ssm start-session --region ${var.aws_region} --target ${module.host.instance_id} --document-name AWS-StartPortForwardingSession --parameters portNumber=8000,localPortNumber=8000"
}

output "backup_bucket" {
  description = "Configure as the S3 destination for Coolify's scheduled database backups."
  value       = module.host.backup_bucket
}

output "cutover" {
  description = "Whether the site and api currently point at the Coolify host."
  value       = var.cutover
}
