# Amplifon X Back-end Interview Exercise

Your task is to develop the REST API for a Store Management System.

This is a progressive exercise: you're **not** required to complete every step.
Choose your goals depending on how much time you plan to devote to this exercise. We will address the remaining points during the review.

You can use the stack and the language that you prefer.

Using (or not) AI assistance will not affect evaluation: what matters is that you will be able to explain and justify what you did (including any mistakes and corrections).

## Development goals

### CRUD Store

Set up the CRUD REST APIs for the Stores. You are free to write your own database schema and Store table. The required APIs are:

- Find One
- Find Many
- Create
- Update
- Delete

Doing an Upsert instead of Create and Update is fine.

### Pagination

Develop a paginated REST query for the Stores.

### Filters

Depending on the schema you chose, add optional filters to the paginated REST query.
To keep it simple, only do string filters. To match, the field has to contain the provided string, even if the casing is different.

#### Example

If we are filtering a Store named `Milano`:

- `MI` _will_ match
- `mi` _will_ match
- `nO` _will_ match
- `miln` _will not_ match

### Sales

Add a Sales table to the database. The required fields are the total amount and the date.
It has to be in a one-to-many relation with Store (one Store, many Sales).

### Paginated Sales

Develop a paginated REST query for the Sales. No filter is needed.

### Create Sale API

Develop a REST API to create a Sale.

### Add total Sales to Store

In the Store object that you return during the Store APIs: add a field that aggregates the total of all sales from that Store.

### Add Sales History to Store

**Only** in the Store object from the Find One query: add a list of all the sales from that Store, sorted in descending order.

### Sales leaderboard

Develop a REST API that returns a Sales leaderboard. You only need the Store name and the total amount of Sales from that Store, and it has to be sorted in descending order by the total amount.

#### Example

```json
[
  {
    "store": "Napoli",
    "amount": 4252.32
  },
  {
    "store": "Rome",
    "amount": 2344.10
  },
  ...
]
```

### Authentication

Add JWT authentication to the system:

- create an User table. We need email, password, and role. The possible roles are:

  - ADMIN
  - SELLER
  - MANAGER

- create a Login API that returns a JWT. The jwt has to contain the user role in the paylod section

- Block every call to the previous APIs from unauthenticated clients

You can choose to seed your users or to create a Sign Up API.

### Role management

We need to give access to the APIs only to the designed roles.

- **ADMIN** can access all APIs
- **SELLER** can access:

  - Find One Store
  - Find Many Stores
  - Paginated Stores
  - Create Sale

- **MANAGER** can access:
  - All Store APIs
  - Paginated Sales
  - Sales Leaderboard

## Technical goals

### DB Migration system

Set up a migration system for your database. The application has to keep the database version up to date. Use whatever library/libraries you want.

### System containerization

Set up containers for your app and your database. Choose whatever orchestrator you want.

### System testing

Set up tests to check various parts of your system, like:

- ensuring that you can migrate up and down correctly
- ensuring that you can build your containers
- ensuring that your application starts without any panic / exception

### E2E testing

Set up tests for your APIs. They have to interface to the server like a client would (HTTP calls) and _nothing has to be mocked_.

### Testing CI Pipeline

Bring your tests into a CI job and run them at every push.

### Docgen (OpenAPI)

Set up a CI job that generates an OpenAPI schema from your server definitions and commits it into your repository every time you push.
