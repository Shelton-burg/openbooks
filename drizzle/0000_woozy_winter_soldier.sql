CREATE TABLE `book_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`owner` text NOT NULL,
	`event_key` text NOT NULL,
	`bank_use` text,
	`document_number` text,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_owner_key` ON `book_events` (`owner`,`event_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_owner_bank` ON `book_events` (`owner`,`bank_use`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_owner_number` ON `book_events` (`owner`,`document_number`);--> statement-breakpoint
CREATE INDEX `events_owner_seq` ON `book_events` (`owner`,`seq`);--> statement-breakpoint
CREATE TABLE `book_settings` (
	`owner` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
