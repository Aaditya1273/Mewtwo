"""Centralized ATTEST failure reasons. Every rejection carries exactly one of these."""

from enum import StrEnum


class Reason(StrEnum):
    SESSION_NOT_FOUND = "SESSION_NOT_FOUND"
    SESSION_EXPIRED = "SESSION_EXPIRED"
    INVALID_STATE = "INVALID_STATE"
    INVALID_NONCE = "INVALID_NONCE"
    NONCE_REPLAY = "NONCE_REPLAY"
    INVALID_SIGNATURE = "INVALID_SIGNATURE"
    INVALID_IDENTITY = "INVALID_IDENTITY"
    SGT_NOT_ELIGIBLE = "SGT_NOT_ELIGIBLE"
    EVIDENCE_CHAIN_INVALID = "EVIDENCE_CHAIN_INVALID"
    POLICY_NOT_SATISFIED = "POLICY_NOT_SATISFIED"
    AUTOMATION_DETECTED = "AUTOMATION_DETECTED"
    ALREADY_CLAIMED = "ALREADY_CLAIMED"
    ATTESTATION_FAILED = "ATTESTATION_FAILED"
    STAKE_REQUIRED = "STAKE_REQUIRED"
    STAKE_FAILED = "STAKE_FAILED"
    UNKNOWN_MISSION = "UNKNOWN_MISSION"
    NETWORK_ERROR = "NETWORK_ERROR"


# HTTP status per reason; anything unlisted is a 400.
HTTP_STATUS = {
    Reason.SESSION_NOT_FOUND: 404,
    Reason.UNKNOWN_MISSION: 404,
    Reason.INVALID_SIGNATURE: 401,
    Reason.INVALID_IDENTITY: 401,
    Reason.SGT_NOT_ELIGIBLE: 403,
    Reason.NONCE_REPLAY: 409,
    Reason.ALREADY_CLAIMED: 409,
    Reason.INVALID_STATE: 409,
    Reason.SESSION_EXPIRED: 410,
    Reason.NETWORK_ERROR: 502,
    Reason.ATTESTATION_FAILED: 502,
    Reason.STAKE_FAILED: 402,
    Reason.STAKE_REQUIRED: 402,
}


class AttestError(Exception):
    def __init__(self, reason: Reason, detail: str = ""):
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason
        self.detail = detail
