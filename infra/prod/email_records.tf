# Email records, copied verbatim from what BigRock serves today (T-168).
#
# Moving the nameservers to Route 53 replaces every record at once. These are
# what keep email working through that move:
#
#   - MX + SPF + verification: the Google Workspace inbox. Without the MX, no
#     mail reaches any @coldrecall.info address — not just the app's mail.
#   - google._domainkey: Google's signing key for mail sent from Workspace.
#   - k1._domainkey: Mailgun's signing key, which is what signs the app's
#     magic-link and notification emails.
#
# The zone move is done, so the deferred email work landed on 2026-09-13 from
# Mailgun's verification instructions: Mailgun added to SPF, tracking CNAME and
# a reporting-only DMARC policy. Two records Mailgun asked for are deliberately
# NOT here — its MX records, which would take inbound mail away from Google
# Workspace and silence every @coldrecall.info address (Mailgun needs them only
# for inbound routes, and nothing here receives mail), and its standalone SPF
# record, which is merged into the existing one above instead.
#
# TTL 14400 matches the live records.
locals {
  email_records = {
    mx = {
      name    = ""
      type    = "MX"
      ttl     = 14400
      records = ["1 smtp.google.com."]
    }

    # SPF and the site verification share the apex, so they are one TXT set.
    apex_txt = {
      name = ""
      type = "TXT"
      ttl  = 14400
      # One SPF record only. Mailgun's instructions give a bare
      # "v=spf1 include:mailgun.org ~all"; publishing that as a second SPF
      # string would be a permerror and fail both senders, so the include is
      # merged into the existing record instead. Google stays first: it carries
      # the human mail.
      records = [
        "v=spf1 include:_spf.google.com include:mailgun.org ~all",
        "google-site-verification=DdWkwFwFzaxlpReHNfVAI36Io1CKso99RxtcqELabQs",
      ]
    }

    # 408 characters: split into 255-character strings by the dns module.
    dkim_google = {
      name    = "google._domainkey"
      type    = "TXT"
      ttl     = 14400
      records = ["v=DKIM1;k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtYdBM+AGd4c2PXacx/6dDj41YHzvDH5PWvAbG5Q7ieN3fSv9HmMweiToUJPcF6pn/MSRZDSBEObvjR41vcqPGkrHIKy5eH9A+bcOZ/x8nUH1LOn4Boqu2oV2fKyBbOi89DUjA8aoJ7V0B7+dl7Jzukh36ZWG4vG5NLm5n/u1wFL/Vi4piTAa2YNeCtHcbWAa+ZybcYIzAbdYJ/obQHuFikWLjL2DfvZdFFWZqDT4e0FyMcIcVA74wGTngJB4C1ACBGsVkTFMeDRJPZsDAHa0AGZWLpyg4fQTX7HoKA8BJk30Lsodr4a4E5fkxyl/kx62HXjuP7C0oqFIcr7nFqwUAQIDAQAB"]
    }

    dkim_mailgun = {
      name    = "k1._domainkey"
      type    = "TXT"
      ttl     = 14400
      records = ["k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDGZrQW5BoAdkBQhmsNdHDxS1EmA5bYP9rq9kI6TEsQo6w3dfDZddYU3H/oBEGWBXhKNyS9anrUrSmjRkk66gf3WSz40Xo5dA0LZgznn3qpRrk/EesSFmCI14KzlbIoQ6FcDI7Hz/5Gx/Qyhj4cQ1jK1y3QGGJ1LvB0pIszkih3qQIDAQAB"]
    }

    # Mailgun's open/click tracking host.
    mailgun_tracking = {
      name    = "email"
      type    = "CNAME"
      ttl     = 14400
      records = ["mailgun.org"]
    }

    # `p=none` only reports; it asks no receiver to reject anything, so it
    # cannot break delivery. Leave it at none until the Mailgun aggregate
    # reports show both senders aligning, then tighten.
    dmarc = {
      name    = "_dmarc"
      type    = "TXT"
      ttl     = 14400
      records = ["v=DMARC1; p=none; pct=100; fo=1; ri=3600; rua=mailto:da7b0f95@dmarc.mailgun.org,mailto:xpnvieaw4ec@inbox.ondmarc.com; ruf=mailto:da7b0f95@dmarc.mailgun.org,mailto:xpnvieaw4ec@inbox.ondmarc.com;"]
    }
  }
}
