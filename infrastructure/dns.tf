data "aws_route53_zone" "selected" {
  name         = var.base_domain
  private_zone = false
}

resource "aws_route53_record" "frontend_cname" {
  zone_id = data.aws_route53_zone.selected.zone_id
  name    = "${var.frontend_hostname}.${var.base_domain}"
  type    = "CNAME"
  ttl     = 300
  records = [var.frontend_cname_target]
}

# Route53 Record for ACM Certificate Validation
resource "aws_route53_record" "api_gateway_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api_gateway_cert.domain_validation_options : dvo.domain_name => {
      name    = dvo.resource_record_name
      record  = dvo.resource_record_value
      type    = dvo.resource_record_type
      zone_id = data.aws_route53_zone.selected.zone_id
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = each.value.zone_id
}
resource "aws_route53_record" "api_gateway_a_record" {
  zone_id = data.aws_route53_zone.selected.zone_id
  name    = aws_apigatewayv2_domain_name.api_gateway_domain_name.domain_name
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.api_gateway_domain_name.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.api_gateway_domain_name.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}