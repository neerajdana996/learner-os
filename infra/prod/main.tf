module "host" {
  source = "../modules/coolify-host"

  project_name   = var.project_name
  instance_type  = var.instance_type
  root_volume_gb = var.root_volume_gb

  database_access_cidrs = var.database_access_cidrs
}

# --- Web records, before and after cutover ---
#
# Keyed by name rather than by type, deliberately. `api` is a CNAME today and an
# A record after cutover, and Route 53 refuses a CNAME and an A at the same name
# at once. One key means Terraform replaces the record in place (destroy, then
# create) instead of trying to create the new one alongside the old.
locals {
  host_ip = module.host.public_ip

  web_records = {
    apex = {
      name    = ""
      type    = "A"
      ttl     = 300
      records = [var.cutover ? local.host_ip : var.legacy_web_ip]
    }
    www = {
      name    = "www"
      type    = "A"
      ttl     = 300
      records = [var.cutover ? local.host_ip : var.legacy_web_ip]
    }
    api = {
      name    = "api"
      type    = var.cutover ? "A" : "CNAME"
      ttl     = 300
      records = [var.cutover ? local.host_ip : var.legacy_api_host]
    }
    # Coolify's dashboard. New, so safe to point at the host from the start:
    # nothing answers on it until the instance domain is set inside Coolify —
    # which must only happen after the admin account exists, or the first
    # visitor to this name can register as admin.
    deploy = {
      name    = "deploy"
      type    = "A"
      ttl     = 300
      records = [local.host_ip]
    }
  }
}

module "dns" {
  source = "../modules/dns"

  domain_name = var.domain_name
  records     = merge(local.web_records, local.email_records)
}

# --- Spend alerts ---
#
# `include_credit = false` is the important line. AWS Budgets subtracts credits
# by default, so while the $100 credit is being used up, net spend reads $0 and
# no alert would ever fire — you would find out when the credit ran out.
resource "aws_budgets_budget" "monthly" {
  name         = "${var.project_name}-monthly-gross"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = false
    include_refund = false
  }

  dynamic "notification" {
    for_each = [50, 80, 100]

    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}
