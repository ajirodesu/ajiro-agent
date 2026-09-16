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

# Link the NDK C++ shared runtime explicitly: across AGP/NDK/CMake combos
# the implicit STL linkage is not always emitted (observed: link without any
# C++ runtime despite ANDROID_STL=c++_shared), failing with undefined
# `operator new` / `std::*`. The name resolves via the driver's own sysroot
# search paths on every host OS; Gradle packages libc++_shared.so per the
# ANDROID_STL setting in build.gradle.
target_link_libraries(pty_bridge ${log-lib} c++_shared)
