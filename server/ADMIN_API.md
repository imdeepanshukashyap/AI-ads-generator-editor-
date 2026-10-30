# Admin API

All endpoints below require `Authorization: Bearer <Clerk session token>`. The token's Clerk user must also exist in the database with `role = ADMIN` and `status = active`.

## Endpoints

| Method | URL | Purpose |
| --- | --- | --- |
| GET | `/api/admin/dashboard` | Dashboard statistics and recent activity |
| GET | `/api/admin/users?page=1&limit=20&search=&role=USER&status=active` | Paginated user list |
| GET | `/api/admin/users/:id` | User profile and generation summary |
| PATCH | `/api/admin/users/:id` | `{ "role": "USER", "status": "suspended" }` |
| DELETE | `/api/admin/users/:id` | Soft-deactivate a non-admin user |
| GET | `/api/admin/generations?page=1&limit=20&type=image&status=SUCCESS&userId=` | Paginated real project generations |
| GET | `/api/admin/generations/:id` | Generation details |
| DELETE | `/api/admin/generations/:id` | Delete a generation record, not storage files |
| GET | `/api/admin/credits` | Credit totals and top users |
| PATCH | `/api/admin/users/:id/credits` | `{ "amount": 100, "operation": "ADD", "reason": "Promotion" }` |
| GET | `/api/admin/analytics?period=7d` | Daily users, generations, credits, and success metrics |
| GET | `/api/admin/logs?page=1&limit=20&action=CREDITS_ADDED&adminId=` | Audit log list |
| GET | `/api/admin/settings` | System settings |
| PATCH | `/api/admin/settings` | Update validated keys such as `{ "maintenanceMode": false, "defaultUserCredits": 20 }` |
| GET | `/api/admin/health` | Database, AI configuration, storage, and server health |

Responses use `{ success, data, message }`; list responses additionally include `pagination`. Authentication failures return `401`, non-admins return `403`, invalid input returns `400`, and missing resources return `404`.

## First admin

After the user signs in once and their user row exists, run:

```sh
npm run promote-admin -- user_clerk_id
```

This changes only the database role. Never expose this command through an HTTP endpoint.

## Data limitations

The existing `Project` model does not store a provider/model, generation category, or per-operation credit ledger. Admin generation type, status, model, and consumed credits are therefore derived from the existing project fields. Exact historical credit usage and daily/monthly credit charts require a future generation ledger model.