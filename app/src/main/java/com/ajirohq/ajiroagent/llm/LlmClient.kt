package com.ajirohq.ajiroagent.llm

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.util.concurrent.TimeUnit

class LlmClient(private val apiKey: String, private val baseUrl: String = "https://api.openai.com/v1") {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    fun streamCompletion(model: String, prompt: String): Flow<String> = flow {
        val request = Request.Builder()
            .url("$baseUrl/chat/completions")
            .addHeader("Authorization", "Bearer $apiKey")
            .addHeader("Content-Type", "application/json")
            .post(
                okhttp3.RequestBody.create(
                    okhttp3.MediaType.parse("application/json"),
                    """{"model":"$model","messages":[{"role":"user","content":"$prompt"}],"stream":true}"""
                )
            )
            .build()

        val sseFactory = EventSources.createFactory(client)
        kotlinx.coroutines.channels.Channel<String>(100).apply {
            val listener = object : EventSourceListener() {
                override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                    if (data != "[DONE]") {
                        trySend(data)
                    } else {
                        close()
                    }
                }

                override fun onFailure(eventSource: EventSource, t: Throwable?, response: okhttp3.Response?) {
                    close(t)
                }
            }

            sseFactory.newEventSource(request, listener)
            for (chunk in this) {
                emit(chunk)
            }
        }
    }
}
