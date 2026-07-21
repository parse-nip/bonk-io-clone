import { DurableObject } from "cloudflare:workers";
import type { LobbyMessage, LobbyResponse, RoomSummary } from "../shared/protocol";

export class LobbyDirectory extends DurableObject {
  private rooms = new Map<string, RoomSummary>();

  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") {
      return Response.json({
        type: "rooms",
        rooms: [...this.rooms.values()],
      } satisfies LobbyResponse);
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const msg = (await request.json()) as LobbyMessage;

    switch (msg.type) {
      case "register":
      case "update":
        this.rooms.set(msg.room.code, msg.room);
        return Response.json({ type: "ok" } satisfies LobbyResponse);
      case "unregister":
        this.rooms.delete(msg.code);
        return Response.json({ type: "ok" } satisfies LobbyResponse);
      case "list":
        return Response.json({
          type: "rooms",
          rooms: [...this.rooms.values()],
        } satisfies LobbyResponse);
      default:
        return new Response("bad request", { status: 400 });
    }
  }
}
