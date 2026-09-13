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
# Copied as they are, not improved. Adding Mailgun to the SPF record and
# publishing a DMARC policy are deliberately left for later — wanted, but a
# separate change from moving the zone, so that if email misbehaves after the
# move there is exactly one thing that could have caused it.
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
      records = [
        "v=spf1 include:_spf.google.com ~all",
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
  }
}
