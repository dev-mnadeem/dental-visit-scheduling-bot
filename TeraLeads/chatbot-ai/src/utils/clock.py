"""Appointment dates are interpreted in the configured business timezone."""
import os
from datetime import datetime
from zoneinfo import ZoneInfo

BUSINESS_TIMEZONE = ZoneInfo(os.getenv("BUSINESS_TIMEZONE", "UTC"))


def business_now() -> datetime:
    return datetime.now(BUSINESS_TIMEZONE)
