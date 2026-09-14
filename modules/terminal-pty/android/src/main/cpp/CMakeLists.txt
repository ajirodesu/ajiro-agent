cmake_minimum_required(VERSION 3.22.1)
project(pty_bridge)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(
  pty_bridge
  SHARED
  pty_bridge.cpp
  pty_session.cpp
)

find_library(log-lib log)

target_link_libraries(pty_bridge ${log-lib})
