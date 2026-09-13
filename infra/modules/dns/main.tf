# The coldrecall.info zone in Route 53 (T-168). BigRock stays the registrar;
# only the nameservers move, and only once this zone mirrors what is live.

variable "domain_name" {
  type = string
}

variable "records" {
  description = "Record sets keyed by a stable id. `name` is relative to the zone; \"\" is the apex."
  type = map(object({
    name    = string
    type    = string
    ttl     = number
    records = list(string)
  }))
}

resource "aws_route53_zone" "this" {
  name    = var.domain_name
  comment = "Managed by Terraform (infra/prod)"
}

resource "aws_route53_record" "this" {
  for_each = var.records

  zone_id = aws_route53_zone.this.zone_id
  name    = each.value.name == "" ? var.domain_name : "${each.value.name}.${var.domain_name}"
  type    = each.value.type
  ttl     = each.value.ttl

  # Route 53 caps one TXT string at 255 characters. A longer value — a
  # 2048-bit DKIM key — is sent as consecutive quoted strings, which resolvers
  # join back into one. Sent whole it is rejected; truncated, email signing
  # silently breaks.
  records = [
    for r in each.value.records :
    each.value.type == "TXT" && length(r) > 255 ? join("\"\"", regexall(".{1,255}", r)) : r
  ]
}

output "zone_id" {
  value = aws_route53_zone.this.zone_id
}

output "name_servers" {
  value = aws_route53_zone.this.name_servers
}
