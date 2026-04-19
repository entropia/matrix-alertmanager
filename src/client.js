const striptags = require('striptags')
const log = require('./log')

let joinedRoomsCache = []

let roomRetryInfo = {}

const client = {
    ensureInRoom: async function(roomId) {
        const currentTime = Date.now();

        if (!roomRetryInfo[roomId]) {
            roomRetryInfo[roomId] = { lastAttempt: 0, retryCount: 0 };
        }

        const timeSinceLastAttempt = currentTime - roomRetryInfo[roomId].lastAttempt;

        // Calculate the delay using exponential back-off, starting from 1 second (1000 ms).
        // 2 ** retryCount will double the wait time with each failure.
        const delay = Math.min((2 ** roomRetryInfo[roomId].retryCount) * 1000, 60000); // Cap delay at 60 seconds.

        if (timeSinceLastAttempt < delay) {
            return;
        }

        roomRetryInfo[roomId].lastAttempt = currentTime;

        if (!joinedRoomsCache.includes(roomId)) {
            try {
                log.info(`Joining room ${roomId}`)
                const room = await client.connection.joinRoom(roomId)
                if (room) {
                    joinedRoomsCache.push(room.roomId)
                    roomRetryInfo[roomId].retryCount = 0;
                }
            } catch (ex) {
                log.warn(`Could not join room ${roomId} - ${ex}`)
                roomRetryInfo[roomId].retryCount++;
            }
        }
    },
    init: async function() {
        const matrix = await import('matrix-js-sdk')
        // Init Matrix client
        this.connection = matrix.createClient({
            baseUrl: process.env.MATRIX_HOMESERVER_URL,
            accessToken: process.env.MATRIX_TOKEN,
            userId: process.env.MATRIX_USER,
            localTimeoutMs: 30000,
        })

        // Ensure in right rooms
        const rooms = await this.connection.getJoinedRooms()
        const joinedRooms = rooms.joined_rooms
        const roomConfigs = process.env.MATRIX_ROOMS.split('|')
        roomConfigs.forEach(async roomConfig => {
            const i = roomConfig.lastIndexOf('/')
            const room = roomConfig.slice(i+1)
            if (joinedRooms.indexOf(room) === -1) {
                log.info(`Joining room ${room}`)
                await this.ensureInRoom(room)
            } else {
                log.info(`Already in room ${room}`)
                joinedRoomsCache.push(room)
            }
        })
    },
    sendAlert: async function(roomId, alert) {
        await this.ensureInRoom(roomId)
        return this.connection.sendEvent(
            roomId,
            'm.room.message',
            {
                'body': striptags(alert),
                'formatted_body': alert,
                'msgtype': 'm.text',
                'format': 'org.matrix.custom.html'
            },
            '',
        )
    },
}

module.exports = client
