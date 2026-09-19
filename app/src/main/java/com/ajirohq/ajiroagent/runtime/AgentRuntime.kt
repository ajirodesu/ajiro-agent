package com.ajirohq.ajiroagent.runtime

import com.ajirohq.ajiroagent.llm.LlmClient
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

sealed class AgentEvent {
    data class Token(val text: String) : AgentEvent()
    data class ToolCall(val name: String, val input: String) : AgentEvent()
    data class Error(val message: String) : AgentEvent()
}

class AgentRuntime(private val llmClient: LlmClient) {

    fun runAgent(model: String, prompt: String): Flow<AgentEvent> = flow {
        try {
            llmClient.streamCompletion(model, prompt).collect { chunk ->
                emit(AgentEvent.Token(chunk))
            }
        } catch (e: Exception) {
            emit(AgentEvent.Error(e.message ?: "Unknown error"))
        }
    }
}
