variable "base_domain" {
  description = "The base domain for the application (e.g., example.com)"
  type        = string
  nullable    = false
}

variable "frontend_hostname" {
  description = "The hostname for the frontend (e.g., www or splat-notifyer)"
  type        = string
  default     = "splat-notifyer"
}

variable "frontend_cname_target" {
  description = "The target CNAME for the frontend (e.g., a CloudFront distribution URL or ALB DNS name)"
  type        = string
  nullable    = false
}

variable "api_hostname" {
  description = "The hostname for the API Gateway (e.g., api)"
  type        = string
  default     = "api-splat-notifyer"
}
variable "aws_region" {
  description = "The AWS region where resources will be deployed"
  type        = string
  default     = "us-east-1"
}

