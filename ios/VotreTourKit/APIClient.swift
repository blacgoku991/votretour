import Foundation

/// Erreurs remontées à l'interface, déjà traduites.
public enum APIError: LocalizedError, Equatable {
    case network
    case server(message: String, code: String?)
    case decoding
    case notFound

    public var errorDescription: String? {
        switch self {
        case .network:
            return "Connexion impossible. Vérifiez votre réseau."
        case .server(let message, _):
            return message
        case .decoding:
            return "Réponse inattendue du serveur."
        case .notFound:
            return "Cet établissement est introuvable."
        }
    }

    /// La file est-elle simplement fermée ou en pause ? (cas non bloquant)
    public var isQueueUnavailable: Bool {
        if case .server(_, let code) = self {
            return code == "queue_closed" || code == "queue_paused"
        }
        return false
    }
}

/// Client HTTP de VotreTour.
///
/// Aucune dépendance externe : `URLSession` suffit, et l'App Clip doit
/// rester minuscule (Apple plafonne sa taille). Le jeton de session de
/// l'appareil est transmis en `Authorization: Bearer`, jamais en cookie.
public actor APIClient {

    public static let shared = APIClient()

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(baseURL: URL = Configuration.apiBaseURL) {
        self.baseURL = baseURL

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 12
        configuration.timeoutIntervalForResource = 25
        configuration.waitsForConnectivity = true
        configuration.httpAdditionalHeaders = [
            "Accept": "application/json",
            // Permet au serveur de choisir le bon canal de notification.
            "X-VotreTour-Platform": Configuration.isAppClip ? "ios_appclip" : "ios_app",
        ]
        self.session = URLSession(configuration: configuration)
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    private let baseURL: URL

    // MARK: - Points d'entrée

    /// Résout une plaque (le `slug` extrait de l'URL d'invocation).
    public func entryPoint(slug: String, countScan: Bool = true) async throws -> EntryPoint {
        var components = URLComponents(
            url: baseURL.appendingPathComponent("api/client/entry-point"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "slug", value: slug),
            URLQueryItem(name: "scan", value: countScan ? "1" : "0"),
            URLQueryItem(name: "source", value: Configuration.isAppClip ? "appclip" : "link"),
        ]
        guard let url = components?.url else { throw APIError.notFound }
        return try await send(request: URLRequest(url: url), as: EntryPoint.self, token: nil)
    }

    /// Rejoint la file. Retourne aussi le jeton de session si l'appareil
    /// n'en avait pas encore.
    public func join(
        slug: String,
        name: String?,
        staffId: String?,
        serviceId: String?,
        token: String?
    ) async throws -> JoinResponse {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/client/join"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(JoinBody(
            slug: slug,
            name: name?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
            staffId: staffId,
            serviceId: serviceId,
            source: "appclip"
        ))
        return try await send(request: request, as: JoinResponse.self, token: token)
    }

    /// État courant du ticket de cet appareil.
    public func ticket(
        organizationId: String,
        entryId: String?,
        token: String
    ) async throws -> TicketState? {
        var components = URLComponents(
            url: baseURL.appendingPathComponent("api/client/ticket"),
            resolvingAgainstBaseURL: false
        )
        var items = [URLQueryItem(name: "organizationId", value: organizationId)]
        if let entryId { items.append(URLQueryItem(name: "entryId", value: entryId)) }
        components?.queryItems = items
        guard let url = components?.url else { throw APIError.notFound }
        let response = try await send(request: URLRequest(url: url), as: TicketResponse.self, token: token)
        return response.ticket
    }

    /// Quitter la file, signaler son retour, se déclarer présent.
    public func act(
        organizationId: String,
        entryId: String,
        action: String,
        token: String
    ) async throws -> ActionResponse {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/client/action"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(ActionBody(
            organizationId: organizationId, entryId: entryId, action: action
        ))
        return try await send(request: request, as: ActionResponse.self, token: token)
    }

    /// Déclare le lancement de l'App Clip et son jeton de notification.
    @discardableResult
    public func registerAppClipSession(
        organizationId: String,
        locationId: String?,
        invocationURL: String,
        deviceToken: String?,
        authorizationStatus: String,
        token: String
    ) async throws -> AppClipSessionResponse {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/client/appclip/session"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(AppClipSessionBody(
            organizationId: organizationId,
            locationId: locationId,
            invocationUrl: invocationURL,
            bundleId: Configuration.bundleIdentifier,
            deviceToken: deviceToken,
            authorizationStatus: authorizationStatus,
            appClipVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
            environment: Configuration.apnsEnvironment == "production" ? "production" : "sandbox"
        ))
        return try await send(request: request, as: AppClipSessionResponse.self, token: token)
    }

    // MARK: - Transport

    private func send<T: Decodable>(
        request: URLRequest,
        as type: T.Type,
        token: String?
    ) async throws -> T {
        var request = request
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.network
        }

        guard let http = response as? HTTPURLResponse else { throw APIError.network }

        let envelope: APIEnvelope<T>
        do {
            envelope = try decoder.decode(APIEnvelope<T>.self, from: data)
        } catch {
            // Un corps illisible sur un code d'erreur reste une erreur serveur.
            if http.statusCode >= 400 { throw APIError.server(message: "Erreur \(http.statusCode).", code: nil) }
            throw APIError.decoding
        }

        if envelope.ok, let payload = envelope.data {
            return payload
        }
        if http.statusCode == 404 { throw APIError.notFound }
        throw APIError.server(
            message: envelope.error ?? "Une erreur est survenue.",
            code: envelope.code
        )
    }
}

// MARK: - Corps de requête

private struct JoinBody: Encodable {
    let slug: String
    let name: String?
    let staffId: String?
    let serviceId: String?
    let source: String
}

private struct ActionBody: Encodable {
    let organizationId: String
    let entryId: String
    let action: String
}

private struct AppClipSessionBody: Encodable {
    let organizationId: String
    let locationId: String?
    let invocationUrl: String
    let bundleId: String
    let deviceToken: String?
    let authorizationStatus: String
    let appClipVersion: String?
    let environment: String
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
