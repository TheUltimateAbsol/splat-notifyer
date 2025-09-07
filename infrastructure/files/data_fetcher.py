import json
import urllib.request
import os
import boto3

def handler(event, context):
    schedules_url = "https://splatoon3.ink/data/schedules.json"
    user_agent = "splat-notifyer data cache job"
    s3_bucket_name = os.environ.get("S3_BUCKET_NAME")
    s3_key = "data.json"

    if not s3_bucket_name:
        print("S3_BUCKET_NAME environment variable not set.")
        return {
            'statusCode': 500,
            'body': json.dumps('S3_BUCKET_NAME not set.')
        }

    try:
        req = urllib.request.Request(schedules_url, headers={'User-Agent': user_agent})
        with urllib.request.urlopen(req) as response:
            schedules_data = response.read().decode('utf-8')

        s3 = boto3.client('s3')
        s3.put_object(Bucket=s3_bucket_name, Key=s3_key, Body=schedules_data, ContentType='application/json')

        return {
            'statusCode': 200,
            'body': json.dumps(f'Successfully fetched schedules and uploaded to s3://{s3_bucket_name}/{s3_key}')
        }
    except Exception as e:
        print(f"Error fetching or uploading data: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps(f'Error: {str(e)}')
        }