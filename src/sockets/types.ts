import 'socket.io'

declare module 'socket.io' {
  interface SocketData {
    user: { id: string; role: string }
    // Per-camp send authorization, computed on chat:connectCamp (chat.handlers).
    byCamp?: Map<string, { groupId: string | null; canOrganizers: boolean }>
  }
}
