class Socket {
    socket: null | WebSocket
    constructor() {
        this.socket = null
    }
    connect(url: string) {
        if (!this.socket) {
            this.socket = new WebSocket(url)
        }
    }
    disconnect() {
        if (this.socket) {
            this.socket.close()
            this.socket = null
        }
    }
    send(message: JSON) {
        if (this.socket) {
            this.socket.send(JSON.stringify(message))
        }
    }
    on(event: string, callback: (event: Event) => void) {
        if (this.socket) {
            this.socket.addEventListener(event, callback)
        }
    }
}

export { Socket }
