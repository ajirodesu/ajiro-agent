cmake_minimum_required(VERSION 3.22.1)
project("ajiroagent")

add_library(
    pty_bridge
    SHARED
    ../../../../modules/terminal-pty/android/src/main/cpp/pty_bridge.cpp
    ../../../../modules/terminal-pty/android/src/main/cpp/pty_session.cpp
)

find_library(
    log-lib
    log
)

target_link_libraries(
    pty_bridge
    ${log-lib}
)
