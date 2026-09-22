import Foundation

/// Canal temps réel Supabase, parlé directement sur le protocole Phoenix.
///
/// Pourquoi pas le SDK Supabase ? Parce qu'un App Clip a une taille
/// plafonnée par Apple, et que le besoin tient en trois messages :
/// rejoindre un canal, répondre aux battements de cœur, recevoir des
/// diffusions. `URLSessionWebSocketTask` suffit, sans aucune dépendance.
///
/// La charge utile reçue ne contient aucune donnée personnelle : des
/// identifiants de ticket opaques et un nombre de personnes devant.
/// L'appareil reconnaît le sien parce qu'il est le seul à le connaître.
public final class RealtimeChannel: NSObject, @unchecked Sendable {

    public enum State: Equatable, Sendable {
        case idle, connecting, joined, disconnected
    }

    private let url: URL
    private let apiKey: String
    private let topic: String
    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var heartbeat: Timer?
    private var reconnectAttempt = 0
    private var isStopped = false
    private var reference = 0

    private let onState: @Sendable (State) -> Void
    private let onMessage: @Sendable (Data) -> Void

    /// - Parameters:
    ///   - supabaseURL: URL du projet (https://xxx.supabase.co)
    ///   - apiKey: clé publique anon — sans droit de lecture sur les tables
    ///   - queueId: identifiant de file ; le canal vaut `queue:<id>`
    public init(
        supabaseURL: URL,
        apiKey: String,
        queueId: String,
        onState: @escaping @Sendable (State) -> Void,
        onMessage: @escaping @Sendable (Data) -> Void
    ) {
        var components = URLComponents(url: supabaseURL, resolvingAgainstBaseURL: false)
        components?.scheme = supabaseURL.scheme == "http" ? "ws" : "wss"
        components?.path = "/realtime/v1/websocket"
        components?.queryItems = [
            URLQueryItem(name: "apikey", value: apiKey),
            URLQueryItem(name: "vsn", value: "2.0.0"),
        ]
        self.url = components?.url ?? supabaseURL
        self.apiKey = apiKey
        self.topic = "realtime:queue:\(queueId)"
        self.onState = onState
        self.onMessage = onMessage
        super.init()
    }

    public func connect() {
        guard !isStopped else { return }
        onState(.connecting)

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        let session = URLSession(configuration: configuration)
        self.session = session

        let task = session.webSocketTask(with: url)
        self.task = task
        task.resume()

        join()
        receive()
        startHeartbeat()
    }

    public func stop() {
        isStopped = true
        heartbeat?.invalidate()
        heartbeat = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        session?.invalidateAndCancel()
        session = nil
        onState(.idle)
    }

    // MARK: - Protocole Phoenix v2
    // Chaque trame est un tableau : [join_ref, ref, topic, event, payload]

    private func nextRef() -> String {
        reference += 1
        return String(reference)
    }

    private func join() {
        let ref = nextRef()
        let frame: [Any] = [
            ref, ref, topic, "phx_join",
            ["config": ["broadcast": ["self": false, "ack": false],
                        "presence": ["key": ""]]],
        ]
        send(frame)
    }

    private func startHeartbeat() {
        heartbeat?.invalidate()
        let timer = Timer(timeInterval: 25, repeats: true) { [weak self] _ in
            guard let self else { return }
            let ref = self.nextRef()
            self.send([NSNull(), ref, "phoenix", "heartbeat", [:]])
        }
        RunLoop.main.add(timer, forMode: .common)
        heartbeat = timer
    }

    private func send(_ frame: [Any]) {
        guard let task,
              let data = try? JSONSerialization.data(withJSONObject: frame),
              let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { [weak self] error in
            if error != nil { self?.scheduleReconnect() }
        }
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                self.scheduleReconnect()
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handle(Data(text.utf8))
                case .data(let data):
                    self.handle(data)
                @unknown default:
                    break
                }
                self.receive()
            }
        }
    }

    private func handle(_ data: Data) {
        guard let frame = try? JSONSerialization.jsonObject(with: data) as? [Any],
              frame.count >= 5 else { return }

        let event = frame[3] as? String

        if event == "phx_reply",
           let payload = frame[4] as? [String: Any],
           (payload["status"] as? String) == "ok" {
            reconnectAttempt = 0
            onState(.joined)
            return
        }

        // Diffusion : { type: "broadcast", event: "state", payload: {...} }
        if event == "broadcast",
           let wrapper = frame[4] as? [String: Any],
           let payload = wrapper["payload"],
           let body = try? JSONSerialization.data(withJSONObject: payload) {
            onMessage(body)
        }
    }

    private func scheduleReconnect() {
        guard !isStopped else { return }
        onState(.disconnected)
        heartbeat?.invalidate()
        task?.cancel(with: .abnormalClosure, reason: nil)
        task = nil

        // Repli exponentiel plafonné : un client dans un tunnel ne doit
        // pas vider sa batterie en tentatives de reconnexion.
        let delay = min(pow(2.0, Double(min(reconnectAttempt, 5))), 20) + Double.random(in: 0...0.6)
        reconnectAttempt += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, !self.isStopped else { return }
            self.connect()
        }
    }
}

/// État public diffusé sur le canal (miroir de `public_queue_state`).
public struct PublicQueueState: Decodable, Sendable {
    public struct Entry: Decodable, Sendable {
        public let id: String
        public let ahead: Int
        public let status: EntryStatus
    }
    public struct ClosedEntry: Decodable, Sendable {
        public let id: String
        public let status: EntryStatus
    }
    public let queueId: String
    public let status: QueueStatus
    public let waiting: Int
    public let serving: Int
    public let entries: [Entry]
    public let closedEntries: [ClosedEntry]
}
