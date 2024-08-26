# frigate-rclone-manager
The missing link between Frigate and your cloud drive of choice

# how to run it
I suggest using pm2 or something similar. The point is that the script needs to run continously.

# sample .env file
```
MQTT_HOST="my-mqtt-server"
MQTT_PORT=1883
MQTT_USER="some"
MQTT_PASS="thing"
FRAC_WAIT_AFTER_TRIGGERED=1
FRAC_RUN_INTERVAL=15
FRAC_LAUNCH_AFTER_UNTRIGGERED=20
FRAC_EVENT_TIMEOUT=600
FRAC_RCLONE_ACTIONS="rclone sync /opt/frigate/media/clips MyHost:/media/frigate/clips --check-first --ignore-checksum;;rclone sync /opt/frigate/media/recordings MyHost:/media/frigate/recordings --check-first --ignore-checksum"
```
