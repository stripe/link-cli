# Link Python SDK

Typed synchronous and asynchronous clients for agents that use Link. The SDK
accepts application-managed access tokens and covers the same API resources and
parameters shared by the TypeScript and Go SDKs, with Python conventions for
typing, validation, and configuration. It requires Python 3.11 or newer.

## Local installation

Use [uv](https://docs.astral.sh/uv/) for Python and dependency management. From
your application's uv project, add this checkout as an editable dependency:

```bash
uv add --editable /path/to/link-cli/packages/sdk-python
```

The distribution is named `link-sdk`; the import is `link`. This package is not
published yet. The SDK does not log in, store credentials, or manage refresh
tokens; these belong to the application embedding it.

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
uv build
uv run --isolated --no-project --with dist/*.whl tests/smoke_test.py
```

Use `uv add` / `uv add --dev` to manage dependencies and commit the resulting
`uv.lock`. From the repository root, `pnpm run test:python` and
`pnpm run check:python` invoke these checks through uv. CI covers Python 3.11–3.14
with mocked HTTP requests; tests do not require access tokens or live purchases.
