from typing import TypedDict

__all__ = ["Subscription", "ChainSubscription"]


class Subscription(TypedDict):
    """Row from the subscriptions DB table."""
    id: str
    subscriber: str
    service: str
    spend_token: str
    amount_per_cycle: str
    interval_seconds: int
    last_execution_time: int
    subscription_start_time: int
    permit_expiry: int
    created_at_block: int


class ChainSubscription(TypedDict):
    """On-chain struct returned by Subscriptions.getSubscription()."""
    subscriber: str
    service: str
    spendToken: str
    amountPerCycle: int
    interval: int
    lastExecutionTime: int
    subscriptionStartTime: int
    permitExpiry: int
