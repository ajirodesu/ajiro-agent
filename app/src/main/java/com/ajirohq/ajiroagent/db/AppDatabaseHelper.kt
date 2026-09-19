package com.ajirohq.ajiroagent.db

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class AppDatabaseHelper(context: Context) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    companion object {
        const val DATABASE_NAME = "ajiro.db"
        const val DATABASE_VERSION = 1
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                provider_id TEXT,
                model_id TEXT,
                reasoning_effort TEXT NOT NULL DEFAULT 'medium',
                agent_mode TEXT NOT NULL DEFAULT 'build',
                agent_id TEXT,
                selected_file_ids_json TEXT NOT NULL DEFAULT '[]',
                selected_mcp_server_ids_json TEXT,
                selected_skill_ids_json TEXT NOT NULL DEFAULT '[]',
                skill_mode TEXT NOT NULL DEFAULT 'auto',
                web_search_mode TEXT NOT NULL DEFAULT 'smart',
                interaction_mode TEXT NOT NULL DEFAULT 'agent',
                external_folder_session_json TEXT,
                pinned_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                archived_at TEXT
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY NOT NULL,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata_json TEXT,
                status TEXT NOT NULL,
                error TEXT,
                sequence INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(conversation_id) REFERENCES conversations(id)
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS agent_runs (
                id TEXT PRIMARY KEY NOT NULL,
                conversation_id TEXT NOT NULL,
                status TEXT NOT NULL,
                user_message_id TEXT NOT NULL,
                assistant_message_id TEXT NOT NULL,
                provider_id TEXT NOT NULL,
                model_id TEXT NOT NULL,
                input TEXT NOT NULL,
                file_context_source TEXT,
                selected_file_ids_json TEXT NOT NULL DEFAULT '[]',
                external_folder_session_json TEXT,
                started_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                last_error TEXT,
                resume_count INTEGER NOT NULL DEFAULT 0,
                retry_count INTEGER NOT NULL DEFAULT 0,
                max_retries INTEGER NOT NULL DEFAULT 3,
                last_retry_at TEXT,
                agent_mode TEXT NOT NULL DEFAULT 'build',
                agent_id TEXT,
                auto_approve INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(conversation_id) REFERENCES conversations(id)
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                prompt TEXT,
                mode TEXT NOT NULL DEFAULT 'all',
                model_provider_id TEXT,
                model_model_id TEXT,
                temperature REAL,
                enabled INTEGER NOT NULL DEFAULT 1,
                hidden INTEGER NOT NULL DEFAULT 0,
                source_markdown TEXT,
                source_url TEXT,
                last_synced_at TEXT,
                tool_permissions_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS skills (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                instructions TEXT NOT NULL,
                source_markdown TEXT,
                source_url TEXT,
                author TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                auto_match INTEGER NOT NULL DEFAULT 0,
                match_keywords_json TEXT NOT NULL DEFAULT '[]',
                recommended_mcp_server_ids_json TEXT NOT NULL DEFAULT '[]',
                recommended_built_in_tool_keys_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS skill_files (
                id TEXT PRIMARY KEY NOT NULL,
                skill_id TEXT NOT NULL,
                path TEXT NOT NULL,
                content TEXT NOT NULL,
                mime_type TEXT,
                size INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS workspace_files (
                id TEXT PRIMARY KEY NOT NULL,
                display_name TEXT NOT NULL,
                original_name TEXT,
                mime_type TEXT,
                size INTEGER,
                relative_path TEXT NOT NULL UNIQUE,
                source_kind TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS provider_configs (
                id TEXT PRIMARY KEY NOT NULL,
                family TEXT NOT NULL,
                label TEXT NOT NULL,
                auth_type TEXT NOT NULL,
                base_url TEXT,
                enabled INTEGER NOT NULL DEFAULT 0,
                oauth_account_email TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS model_presets (
                id TEXT PRIMARY KEY NOT NULL,
                provider_id TEXT NOT NULL,
                model_id TEXT NOT NULL,
                label TEXT,
                is_default INTEGER NOT NULL DEFAULT 0,
                options_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS mcp_servers (
                id TEXT PRIMARY KEY NOT NULL,
                label TEXT NOT NULL,
                url TEXT NOT NULL,
                transport TEXT NOT NULL,
                auth_mode TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                header_names_json TEXT NOT NULL DEFAULT '[]',
                oauth_client_id TEXT,
                oauth_authorization_url TEXT,
                oauth_token_url TEXT,
                oauth_scopes TEXT,
                oauth_allowed_auth_origin TEXT,
                last_status TEXT NOT NULL DEFAULT 'untested',
                last_error TEXT,
                tool_count INTEGER,
                server_info_json TEXT,
                server_instructions TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS saved_prompts (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS schedules (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                prompt TEXT NOT NULL,
                expression TEXT NOT NULL,
                timezone TEXT NOT NULL,
                provider_id TEXT NOT NULL,
                model_id TEXT NOT NULL,
                auto_approve INTEGER NOT NULL DEFAULT 1,
                enabled INTEGER NOT NULL DEFAULT 1,
                conversation_id TEXT,
                external_folder_session_json TEXT,
                agent_id TEXT,
                last_run_at TEXT,
                next_run_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS schedule_runs (
                id TEXT PRIMARY KEY NOT NULL,
                schedule_id TEXT NOT NULL,
                run_id TEXT,
                status TEXT NOT NULL,
                error TEXT,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                FOREIGN KEY(schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY NOT NULL,
                content TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                source_conversation_id TEXT,
                source_message_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                archived_at TEXT
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS coding_checkpoints (
                id TEXT PRIMARY KEY NOT NULL,
                conversation_id TEXT NOT NULL,
                run_id TEXT,
                project_uri TEXT NOT NULL,
                label TEXT NOT NULL,
                snapshot_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(conversation_id) REFERENCES conversations(id)
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS provenance_events (
                id TEXT PRIMARY KEY NOT NULL,
                action TEXT NOT NULL,
                agent_id TEXT,
                tool TEXT,
                runtime TEXT,
                permission TEXT NOT NULL,
                input TEXT,
                result TEXT,
                ok INTEGER NOT NULL DEFAULT 0,
                session_id TEXT,
                created_at TEXT NOT NULL
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS editor_file_revisions (
                id TEXT PRIMARY KEY NOT NULL,
                project_uri TEXT NOT NULL,
                path TEXT NOT NULL,
                content TEXT NOT NULL,
                author_name TEXT,
                author_avatar_uri TEXT,
                created_at TEXT NOT NULL
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS bot_command_configs (
                id TEXT PRIMARY KEY NOT NULL,
                bot_id TEXT NOT NULL DEFAULT 'default',
                name TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'manual',
                repository_id TEXT,
                md_text TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS bot_command_repositories (
                id TEXT PRIMARY KEY NOT NULL,
                bot_id TEXT NOT NULL DEFAULT 'default',
                url TEXT NOT NULL,
                last_synced_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS bot_modes (
                bot_id TEXT PRIMARY KEY NOT NULL,
                mode TEXT NOT NULL DEFAULT 'agent',
                updated_at TEXT NOT NULL
            );
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE IF NOT EXISTS bot_command_secrets (
                bot_id TEXT NOT NULL,
                command_name TEXT NOT NULL,
                has_api_key INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (bot_id, command_name)
            );
        """.trimIndent())
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Migration logic if schema version advances
    }
}
