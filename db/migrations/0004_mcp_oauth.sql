CREATE TABLE "mcp_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'MCP client' NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_codes" (
	"hash" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text DEFAULT 'MCP client' NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scope" text DEFAULT 'mcp' NOT NULL,
	"resource" text,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"access_hash" text NOT NULL,
	"refresh_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text DEFAULT 'MCP client' NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"scope" text DEFAULT 'mcp' NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_codes" ADD CONSTRAINT "mcp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_codes" ADD CONSTRAINT "mcp_codes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tokens_access" ON "mcp_tokens" USING btree ("access_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tokens_refresh" ON "mcp_tokens" USING btree ("refresh_hash");--> statement-breakpoint
CREATE INDEX "mcp_tokens_org" ON "mcp_tokens" USING btree ("org_id");