# Link Python SDK

Typed synchronous and asynchronous clients for agents that use Link. The SDK
accepts application-managed access tokens and covers the same API resources and
parameters shared by the TypeScript and Go SDKs, with Python conventions for
typing, validation, and configuration. It requires Python 3.11 or newer.

## Installation

```bash
uv add stripe-link-sdk
# Or, with pip:
pip install stripe-link-sdk
```

The distribution is named `stripe-link-sdk`; the import is `link`. The SDK does not log
in, store credentials, or manage refresh tokens; these belong to the application
embedding it.

### Local development installation

Use [uv](https://docs.astral.sh/uv/) for Python and dependency management. From
your application's uv project, add this checkout as an editable dependency:

```bash
uv add --editable /path/to/link-cli/packages/sdk-python
```

## Quick start

```python
import os

from link import Client

with Client(access_token=os.environ["LINK_ACCESS_TOKEN"]) as client:
    payment_methods = client.payment_methods.list()
    for method in payment_methods:
        print(method.id, method.name, method.is_default)
```

For async applications, use the same resource methods with `await`:

```python
import asyncio
import os

from link import AsyncClient


async def main() -> None:
    async with AsyncClient(access_token=os.environ["LINK_ACCESS_TOKEN"]) as client:
        user = await client.user_info.retrieve()
        print(user.name)


asyncio.run(main())
```

The SDK reads no environment variables itself; pass credentials explicitly.

## Credentials and configuration

Provide exactly one of `access_token` or `get_access_token`. For expiring
credentials, provide a token callback:

```python
from link import Client, GetAccessTokenOptions


def get_token(options: GetAccessTokenOptions) -> str:
    return credential_manager.link_access_token(force_refresh=options.force_refresh)


with Client(get_access_token=get_token) as client:
    methods = client.payment_methods.list()
```

The callback runs for every request with `force_refresh=False`. After a 401, it
runs once more with `force_refresh=True`, then the SDK retries the same request
once. Fixed tokens do not retry. Callback exceptions propagate unchanged; an
empty or non-string callback result raises `LinkConfigurationError`. The SDK
also rejects whitespace, control characters, and non-ASCII characters in tokens
before HTTP header construction, keeping invalid tokens out of transport
exception messages. The credential manager should coalesce concurrent
refreshes. `AsyncClient` accepts
either a synchronous callback or an async callback that returns a token; use an
async callback when obtaining a token involves I/O.

Both constructors accept:

| Option | Behavior |
| --- | --- |
| `api_base_url` | Defaults to `https://api.link.com`. |
| `spend_request_base_url` | Defaults to `api_base_url`; used only for spend requests. |
| `default_headers` | Copied at construction. Resource content types and bearer authorization take precedence. |
| `http_client` | An `httpx.Client` or `httpx.AsyncClient`, respectively, for custom timeouts, transports, proxies, and tracing. |
| `timeout` | Timeout in seconds, an `httpx.Timeout`, or `None` to disable timeouts. Defaults to 30 seconds for SDK-owned HTTP clients; an injected client's timeout is preserved when omitted. |
| `verbose`, `logger` | Send method, URL, and status diagnostics to a Python logger; no authorization headers or bodies. |

Base URLs must be absolute HTTP(S) URLs without a query or fragment. Configure
timeouts directly on either client:

```python
import httpx
from link import Client

with Client(access_token=access_token, timeout=httpx.Timeout(30, connect=5)) as client:
    balances = client.balances.list(limit=20)
```

Timeouts apply separately to HTTPX's connect, read, write, and pool operations;
they are not a total deadline across the request and its possible auth retry.
An explicit `timeout=` also overrides an injected HTTP client's timeout for SDK
requests, without modifying that client. Values must be finite and non-negative;
use `None` to disable a timeout.

`close()` / `aclose()` and context-manager exits close only SDK-owned HTTP
clients. The caller closes injected clients. Reuse clients for connection
pooling. Sync clients can be shared across threads when their token providers
are thread-safe; async clients can be shared by tasks within one event loop.
Injected HTTPX query defaults are preserved; resource arguments take precedence
for matching keys.

## User-approved purchase flow

Amounts use the currency's minor unit, such as cents for USD. Purchase context
must be at least 100 characters and explain what the agent is buying and why.

```python
methods = client.payment_methods.list()
if not methods:
    raise RuntimeError("The user needs to add a Link payment method")
method = next((method for method in methods if method.is_default), methods[0])

request = client.spend_requests.create(
    payment_details=method.id,
    credential_type="card",
    amount=2599,
    currency="usd",
    merchant_name="Acme",
    merchant_url="https://acme.example",
    context=(
        "The user asked the agent to buy the selected item from Acme for $25.99, "
        "including the displayed shipping cost."
    ),
)
approval = client.spend_requests.request_approval(request.id)
print(f"Approve this purchase: {approval.approval_url}")
# Persist request.id for retrieval in a later run.
```

Retrieve the request after approval:

```python
request = client.spend_requests.retrieve(spend_request_id)
if request is None:
    raise RuntimeError("Spend request not found")
if request.status == "approved":
    # Pass the returned credential directly to the payment executor.
    pass
elif request.status == "requires_action":
    details = request.status_details
    if details is None or details.requires_action is None:
        raise RuntimeError("Missing action instructions")
    action = details.requires_action.next_action
    if action.resolution == "auto_resume":
        # Schedule a later retrieve of this same request.
        pass
    else:
        print(action.display_message, action.action_url)
```

The SDK does not poll automatically. For `requires_action`, only `auto_resume`
allows automatic polling; otherwise surface the instructions to the user.
Keep returned card and payment-token credentials out of model context, logs,
and user-visible messages. Credential fields are omitted from model `repr`,
but `model_dump()` and `model_dump_json()` include them.

## Recurring payments

Pass `recurring` when the user has agreed to recurring spending:

```python
request = client.spend_requests.create(
    credential_type="card",
    merchant_name="Example Pro",
    merchant_url="https://example.com/subscribe",
    amount=2000,
    currency="usd",
    context=(
        "Monthly access to Example Pro requested by the user, with a spending "
        "limit of $20 per month including all taxes."
    ),
    recurring={"interval": "month"},
    request_approval=True,
)
```

This requests a $20 monthly spending limit. Intervals are `day`, `week`, `month`,
and `year`; optional `interval_count` must be a positive integer and defaults
to `1` on the server. `{"interval": "week", "interval_count": 2}` resets the
limit every two weeks. `amount` is the limit per period. Omit `recurring` for
a one-time purchase. `SpendRequestRecurringParams` is exported for typed callers.
`AsyncClient` accepts the same arguments with `await`.

Use normal approval and credential retrieval. The merchant schedules charges;
recurring card requests stay active after individual charges. Do not wait for
`succeeded` after each payment or create a new request each period. Confirm
payments from the merchant or transaction records and respect returned
credential expiries. `update` cannot change the cadence. `cancel` revokes
the credential but does not cancel the subscription with the merchant.

## Completion callbacks

Pass optional `completion_callback_url` and `nonce` keyword arguments to `client.spend_requests.create()`; synchronous and asynchronous clients support both.

Supply both fields or neither. Use an opaque, unpredictable nonce, save it
unchanged, and verify an exact match when the callback is received. The URL is
limited to 2,048 characters and the nonblank nonce to 512 JavaScript/UTF-16 code
units; the API validates live-mode HTTPS, URL security, and pair validity.
Use returned `approval_url` and `next_action.action_url` strings as-is. Do not
manually append callback parameters when creation-time context was supplied.
Retrieve the request to determine its status after a callback.

## Resources

Both client styles expose the following resources. Arguments after a resource
ID are keyword-only. List methods return one API page without auto-pagination.

| Resource | Methods / result |
| --- | --- |
| `spend_requests` | `create`, `update`, `retrieve`, `cancel` → `SpendRequest`; `retrieve` returns `None` on 404. `list` → list; `request_approval` → `RequestApprovalResponse`. |
| `payment_methods` | `list` → `list[PaymentMethod]` |
| `shipping_addresses` | `list` → `list[ShippingAddressRecord]` |
| `user_info` | `retrieve` → `UserInfo` |
| `transactions` | `list` → `TransactionsPage` |
| `sources` | `list` → `SourcesPage` |
| `balances` | `list` → `BalancesPage` |
| `web_bot_auth` | `sign_url(url)` → `WebBotAuthBlock`; cached by hostname until 30 seconds before expiry. |
| `reports` | `create` → `ReportRecord` |

The resource surface follows the common TypeScript/Go contract. TypeScript's
report `attempt_trace` field is outside that shared contract.

Examples of filters and updates:

```python
history = client.spend_requests.list(include_history=True)
request = client.spend_requests.retrieve("sr_123", include=["card"])
request = client.spend_requests.update("sr_123", line_items=[], totals=[])
page = client.transactions.list(
    limit=20, starting_after="tx_123", start_date="2026-01-01", sources=["source_123"]
)
report = client.reports.create(
    domain="merchant.example", outcome="success", spend_request_id="sr_123", tags=[]
)
```

## Types and errors

Responses are Pydantic models with attribute access. Request methods have typed
keyword arguments; nested request objects use dictionaries. Exported TypedDicts
such as `CreateSpendRequestParams` can also be passed with `**params`. Collection
inputs accept sequences (including tuples) and metadata accepts read-only mappings.
Pass `include` and `sources` as sequences such as `["card"]` and `["source_123"]`;
bare strings are rejected. `JsonPrimitive` and `JsonValue` describe JSON data.

Optional request values set to `None` are omitted; explicit empty collections,
`False`, and `0` are sent. Request enum types describe known values so type
checkers can catch typos; response fields still accept future string values.
The exported `SpendRequestStatus` type also accepts future statuses.
Business rules are validated by the API. Dates remain API strings.

Required response fields must be present and correctly typed. Missing IDs,
statuses, or list envelopes raise `LinkResponseError`; the SDK does not fabricate
empty values. Optional fields default to `None`, and `model_fields_set` or
`model_dump(exclude_unset=True)` distinguish omission from explicit null.
Shipping addresses can omit nullable postal fields and `nickname`, matching
the other SDKs.
Malformed scalar types are rejected without coercion. `TransactionsPage`,
`Source`, `SourcesPage`, `Balance`, and `BalancesPage` retain unknown properties
in `model_extra` and include them in serialized output. Use
`model_dump(exclude_unset=True)` to preserve response field presence.

User info includes an optional `address` of type `UserInfoAddress`. All address
components are optional nullable strings, so sparse addresses such as
`{"country": "ZZ"}` are accepted. Use `model_dump(exclude_unset=True)` to preserve
omitted components and explicit nulls.

In user info, absent wallet enrichment means unavailable. Within present spend
limits, a null limit or remaining amount means unlimited; these are distinct
states.

All SDK-created exceptions inherit `LinkError`:

- `LinkConfigurationError`: invalid credentials or configuration.
- `LinkTransportError`: failed network requests or response reads; preserves the cause.
- `LinkAPIError`: non-success HTTP status, with `status`, `code`, `raw_body`, and `details`.
- `LinkResponseError`: a successful response could not be decoded, with `status` and the cause. Pydantic error text and chained tracebacks hide input values, including credential fields. Explicit inspection of the validation error's `.errors()` can still expose input data.
- `LinkSDKError`: other SDK errors, including invalid Web Bot Auth URLs.

```python
from link import LinkAPIError, get_duplicate_spend_request

try:
    request = client.spend_requests.create(
        context=purchase_context, idempotency_key=stable_purchase_id
    )
except LinkAPIError as error:
    duplicate = get_duplicate_spend_request(error)
    if duplicate is None:
        raise
    request = duplicate
```

## Development

From this package directory:

```bash
uv python install
uv sync --locked
uv run --locked pytest
uv run --locked ruff check .
uv run --locked ruff format --check .
uv run --locked ty check
uv run --locked python -m unittest discover -s scripts
uv build
uv run --locked twine check --strict dist/*
uv run --locked python scripts/release.py validate
uv run --locked python scripts/test_wheel.py dist/*.whl
```

Use `uv add` / `uv add --dev` to manage dependencies and commit the resulting
`uv.lock`. From the repository root, `pnpm run test:python` and
`pnpm run check:python` invoke source tests and lint/type checks through uv.
CI runs the complete SDK suite against the built wheel on Python 3.11–3.14.
Tests use mocked HTTP requests and require no access tokens or live purchases.

The wheel test copies the tests and configuration to a temporary directory,
installs the wheel with locked development tools, and checks that imports come
from the installed distribution. It includes the consumer typing tests and the
import/model smoke test, with no SDK checkout sources available to the tests.
Runtime dependencies are resolved from the wheel's declared requirements.

Twine validates metadata and README rendering. The archive check permits only
Python modules and `py.typed`, plus the license and required packaging metadata;
the source archive also includes `pyproject.toml` and README. It rejects extra or
missing files and compares packaged source files with the checkout. Add any new
runtime data assets explicitly to the archive check before publishing them.
Use an empty `dist/` directory when building a new version; stale artifacts are
rejected too.

## Releasing

Python versions are independent of the npm and Go packages. Prepare a PR that
updates `project.version` in `pyproject.toml`, adds release notes to
[CHANGELOG.md](CHANGELOG.md), and refreshes the lockfile with `uv lock`.
Use a normalized Python version such as `0.2.0` or `0.2.0rc1`.

Merging into `main` publishes the new version to PyPI automatically. The
**Release Python SDK** workflow checks PyPI on each push, skips complete existing
releases, builds a wheel and source distribution, validates their metadata and
contents, and runs the full SDK suite against the release wheel on Python
3.11–3.14. A separate job publishes those artifacts using PyPI Trusted
Publishing and creates attestations for both files. There is no PyPI API token,
manual tag, or additional approval step.
