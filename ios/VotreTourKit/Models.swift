import Foundation

/// Modèles du domaine, calés sur les réponses JSON du serveur.
/// Les identifiants exposés sont toujours des identifiants publics
/// opaques : aucun UUID interne ne transite vers le téléphone.

public enum EntryStatus: String, Codable, Sendable {
    case waiting, notified, returning, present, next, serving
    case completed, absent, skipped, cancelled, expired

    /// Le client occupe-t-il encore une place ?
    public var isActive: Bool {
        switch self {
        case .waiting, .notified, .returning, .present, .next, .serving: return true
        default: return false
        }
    }
}

public enum QueueStatus: String, Codable, Sendable {
    case open, paused, closed
}

public struct ClientEntry: Codable, Equatable, Sendable {
    public let id: String
    public let name: String?
    public let status: EntryStatus
    public let peopleAhead: Int
    public let joinedAt: String?
    public let calledAt: String?
    public let returningAt: String?
    public let serviceStartedAt: String?
    public let completedAt: String?
    public let staffName: String?
}

public struct QueueInfo: Codable, Equatable, Sendable {
    public let id: String
    public let status: QueueStatus
    public let name: String
    public let pauseReason: String?
    public let waiting: Int
}

public struct LocationInfo: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let slug: String
    public let city: String?
    public let addressLine1: String?
    public let postalCode: String?
    public let phone: String?
    public let latitude: Double?
    public let longitude: Double?
    public let mapsUrl: String?
    public let logoUrl: String?
    /// Renseigné uniquement une fois la prestation terminée.
    public let googleReviewUrl: String?
}

public struct TicketState: Codable, Equatable, Sendable {
    public let entry: ClientEntry
    public let queue: QueueInfo
    public let location: LocationInfo
}

// MARK: - Point d'entrée (résolution d'une plaque)

public struct EntryPointOrganization: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let activity: String
    public let logoUrl: String?
}

public struct EntryPointLocation: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let slug: String
    public let city: String?
    public let addressLine1: String?
    public let postalCode: String?
    public let latitude: Double?
    public let longitude: Double?
    public let mapsUrl: String?
    public let phone: String?
    public let logoUrl: String?
    public let timezone: String
    public let hasReviewLink: Bool
}

public struct EntryPointQueue: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let mode: String
    public let status: QueueStatus
    public let askClientName: Bool
    public let clientNameRequired: Bool
    public let allowStaffChoice: Bool
    public let allowServiceChoice: Bool
    public let pauseReason: String?
    public let waitingCount: Int
}

public struct EntryPointStaff: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let roleTitle: String?
    public let avatarUrl: String?
    public let accent: String
    public let onBreak: Bool
    public let waiting: Int
}

public struct EntryPointService: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let durationMinutes: Int?
    public let priceCents: Int?
}

public struct EntryPointPlate: Codable, Equatable, Sendable {
    public let id: String
    public let code: String
    public let label: String
    public let kind: String
    public let staffId: String?
}

public struct EntryPointSettings: Codable, Equatable, Sendable {
    public let showPeopleAhead: Bool
    public let allowClientLeave: Bool
    public let brandAccent: String
    public let locale: String
}

/// Coordonnées du canal temps réel, servies par l'API plutôt que
/// figées dans le binaire : une rotation de clé n'impose pas de mise à
/// jour de l'application sur l'App Store.
public struct RealtimeCredentials: Codable, Equatable, Sendable {
    public let url: String
    public let apiKey: String
    public let channel: String
}

public struct EntryPoint: Codable, Equatable, Sendable {
    public let status: String
    public let slug: String
    public let organization: EntryPointOrganization
    public let location: EntryPointLocation
    public let plate: EntryPointPlate?
    public let queue: EntryPointQueue?
    public let settings: EntryPointSettings
    public let staff: [EntryPointStaff]
    public let services: [EntryPointService]
    public let realtime: RealtimeCredentials?
}

// MARK: - Réponses d'API

public struct JoinResponse: Codable, Sendable {
    public let entry: ClientEntry
    public let rejoined: Bool
    public let queueId: String
    public let organizationId: String
    /// Jeton de session émis aux clients natifs (jamais au web).
    public let sessionToken: String?
}

public struct TicketResponse: Codable, Sendable {
    public let ticket: TicketState?
}

public struct ActionResponse: Codable, Sendable {
    public let entry: ClientEntry
    public let ticket: TicketState?
}

public struct AppClipSessionResponse: Codable, Sendable {
    public let registered: Bool
    public let pushAvailable: Bool
    public let expiresAt: String?
    public let ephemeralWindowHours: Int
}

/// Enveloppe commune à toutes les réponses de l'API.
public struct APIEnvelope<T: Decodable>: Decodable {
    public let ok: Bool
    public let data: T?
    public let error: String?
    public let code: String?
}
