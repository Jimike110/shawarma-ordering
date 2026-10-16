FROM gradle:8.13-jdk21
USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip && rm -rf /var/lib/apt/lists/*
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
RUN curl -fsSL --retry 3 https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip -o /tmp/android-tools.zip \
 && echo '4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583  /tmp/android-tools.zip' | sha256sum -c - \
 && mkdir -p /opt/android-sdk/cmdline-tools \
 && unzip -q /tmp/android-tools.zip -d /opt/android-sdk/cmdline-tools \
 && mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest \
 && rm /tmp/android-tools.zip \
 && yes | /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null
RUN /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager 'platforms;android-36' 'build-tools;36.0.0' 'platform-tools'
WORKDIR /app/android-kitchen
ENV GRADLE_USER_HOME=/cache
ENTRYPOINT ["gradle", "--no-daemon"]
