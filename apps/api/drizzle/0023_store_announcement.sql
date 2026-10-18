CREATE TABLE "store_announcement" (
	"id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"message" text,
	"link_label" text,
	"link_url" text,
	"details" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_announcement_singleton_check" CHECK ("store_announcement"."id" = 1),
	CONSTRAINT "store_announcement_enabled_requires_message_check" CHECK (not "store_announcement"."enabled" or "store_announcement"."message" is not null),
	CONSTRAINT "store_announcement_link_pair_check" CHECK (("store_announcement"."link_label" is null) = ("store_announcement"."link_url" is null)),
	CONSTRAINT "store_announcement_window_check" CHECK ("store_announcement"."starts_at" is null or "store_announcement"."ends_at" is null or "store_announcement"."ends_at" > "store_announcement"."starts_at"),
	CONSTRAINT "store_announcement_version_positive_check" CHECK ("store_announcement"."version" > 0)
);
--> statement-breakpoint
INSERT INTO "store_announcement" ("id", "enabled", "version")
VALUES (1, false, 1);
