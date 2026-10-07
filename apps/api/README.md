# API development seed

The demo seed is available only in development and test environments. It
requires a verified active owner, the migrated `MAIN` warehouse, and an exact
database-name match. Run it twice to confirm the existing demo fixture and farm
provenance extension are recognized without resetting edited farm profiles.

```sh
NODE_ENV=development bun --filter api db:migrate
NODE_ENV=development bun --filter api db:seed:demo --database-name <verified-database-name> --actor-email <active-owner-email> --image-base-url https://assets.example.test/suannn
```

The command reports product, inventory, farm, and farm-link counts. Farm profiles
are explicitly marked as demo records; their names and image assets are
illustrative and do not identify real partner growers.
