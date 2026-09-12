output "public_ip" {
  description = "The instance's stable public IP. Point your API's DNS record here."
  value       = aws_eip.app.public_ip
}

output "ssh_command" {
  description = "Run this to get a shell on the instance."
  value       = "ssh -i ${var.project_name}-key.pem ubuntu@${aws_eip.app.public_ip}"
}

output "ssh_allowed_from" {
  description = "The CIDR actually allowed to SSH in — confirm this is your IP."
  value       = local.ssh_cidr
}
