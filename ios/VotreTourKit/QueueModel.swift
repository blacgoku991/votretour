import Foundation
import SwiftUI

/// Le cerveau de l'expérience client iOS, partagé entre l'App Clip et
/// l'application complète.
///
/// Séquence d'un lancement par NFC ou QR :
///   1. l'URL d'invocation arrive (ou, si l'App Clip a été rouvert depuis
///      une notification, on reprend la dernière connue) ;
///   2. on résout la plaque → établissement, file, équipe ;
///   3. le client rejoint ;
///   4. on ouvre le canal temps réel et on enregistre le jeton APNs ;
///   5. la position descend en direct, avec retour haptique à chaque cran.
@MainActor
public final class QueueModel: ObservableObject {

    public enum Phase: Equatable {
        case loading
        case join
        case queued
        case turn
        case done
        case closed
        case unavailable(String)
    }

    @Published public private(set) var phase: Phase = .loading
    @Published public private(set) var entryPoint: EntryPoint?
    @Published public private(set) var ticket: TicketState?
    @Published public private(set) var waitingCount: Int = 0
    @Published public private(set) var servingCount: Int = 0
    @Published public private(set) var connection: RealtimeChannel.State = .idle
    @Published public var errorMessage: String?
    @Published public var isBusy = false

    /// Saisie du client sur l'écran d'accueil.
    @Published public var name: String = SessionStore.shared.clientName ?? ""
    @Published public var selectedStaffId: String?
    @Published public var selectedServiceId: String?

    private var channel: RealtimeChannel?
    private var pollTask: Task<Void, Never>?
    private var slug: String?
    private var invocationURL: URL?
    private let store = SessionStore.shared
    private let api = APIClient.shared

    public init() {}

    // MARK: - Cycle de vie

    /// Point d'entrée unique, appelé à chaque invocation.
    public func start(url: URL?) async {
        // Apple : relancé depuis une notification ou le sélecteur
        // d'applications, un App Clip démarre SANS URL d'invocation.
        // On repart alors de la dernière connue.
        let resolvedURL = url ?? store.resume.invocationURL
        guard let resolvedURL, let slug = Self.slug(from: resolvedURL) else {
            phase = .unavailable("Approchez votre téléphone de la plaque pour rejoindre la file.")
            return
        }

        // Une nouvelle invocation pour un autre commerce : on repart à zéro.
        if let previous = self.slug, previous != slug {
            teardown()
            ticket = nil
        }

        self.slug = slug
        self.invocationURL = resolvedURL
        store.rememberInvocation(url: resolvedURL, slug: slug)

        await load()
    }

    private func load() async {
        guard let slug else { return }
        phase = ticket == nil ? .loading : phase
        errorMessage = nil

        do {
            let point = try await api.entryPoint(slug: slug)
            entryPoint = point
            waitingCount = point.queue?.waitingCount ?? 0
            store.rememberContext(
                organizationId: point.organization.id,
                locationId: point.location.id
            )

            if let existing = try await currentTicket(organizationId: point.organization.id) {
                apply(ticket: existing)
                await openChannel()
                // Un App Clip relancé depuis TestFlight / notification peut
                // reprendre directement un ticket existant sans repasser par join().
                // On doit quand même (ré)enregistrer APNs à chaque lancement afin
                // d'obtenir/rafraîchir le jeton et la fenêtre de notification.
                await registerForPush()
            } else {
                phase = .join
            }
        } catch let error as APIError {
            phase = .unavailable(error.localizedDescription)
        } catch {
            phase = .unavailable("Connexion impossible. Vérifiez votre réseau.")
        }
    }

    private func currentTicket(organizationId: String) async throws -> TicketState? {
        guard let token = store.effectiveToken(organizationId: organizationId) else { return nil }
        return try await api.ticket(
            organizationId: organizationId,
            entryId: store.resume.entryId,
            token: token
        )
    }

    // MARK: - Rejoindre

    public func join() async {
        guard let slug, let point = entryPoint else { return }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }

        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)

        do {
            let response = try await api.join(
                slug: slug,
                name: trimmed.isEmpty ? nil : trimmed,
                staffId: selectedStaffId ?? point.plate?.staffId,
                serviceId: selectedServiceId,
                token: store.effectiveToken(organizationId: point.organization.id)
            )

            if let issued = response.sessionToken {
                store.setToken(issued, organizationId: point.organization.id)
            }
            store.rememberEntry(response.entry.id)
            if !trimmed.isEmpty { store.clientName = trimmed }

            if let fresh = try await currentTicket(organizationId: point.organization.id) {
                apply(ticket: fresh)
            }

            Haptics.success()
            await openChannel()
            await registerForPush()
        } catch let error as APIError {
            errorMessage = error.localizedDescription
            if error.isQueueUnavailable { await load() }
        } catch {
            errorMessage = "Connexion impossible. Vérifiez votre réseau."
        }
    }

    // MARK: - Actions du client

    public func markReturning() async { await act("returning") }
    public func leaveQueue() async { await act("leave") }

    /// Ferme explicitement l'écran de fin de visite.
    ///
    /// Le ticket terminé reste dans l'historique serveur mais n'est plus
    /// considéré comme la session à reprendre sur cet appareil.
    public func dismissCompleted() {
        guard ticket?.entry.status == .completed else { return }
        teardown()
        store.rememberEntry(nil)
        ticket = nil
        errorMessage = nil
        phase = .join
    }

    private func act(_ action: String) async {
        guard let point = entryPoint,
              let entryId = ticket?.entry.id,
              let token = store.effectiveToken(organizationId: point.organization.id) else { return }
        isBusy = true
        defer { isBusy = false }

        do {
            let response = try await api.act(
                organizationId: point.organization.id,
                entryId: entryId,
                action: action,
                token: token
            )
            if action == "leave" {
                teardown()
                ticket = nil
                store.rememberEntry(nil)
                phase = .join
                await load()
            } else if let fresh = response.ticket {
                apply(ticket: fresh)
                Haptics.light()
            }
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "L'action n'a pas pu être enregistrée."
        }
    }

    /// Reprend depuis le serveur : retour de veille, notification ouverte,
    /// canal temps réel rétabli.
    public func refresh() async {
        guard let point = entryPoint else {
            await load()
            return
        }
        do {
            if let fresh = try await currentTicket(organizationId: point.organization.id) {
                apply(ticket: fresh)
            } else if ticket != nil {
                ticket = nil
                phase = .join
            }
        } catch {
            // Hors ligne : on garde le dernier état affiché plutôt que de
            // faire clignoter un écran vide.
        }
    }

    // MARK: - Temps réel

    private func openChannel() async {
        guard channel == nil,
              let credentials = entryPoint?.realtime,
              let url = URL(string: credentials.url),
              let queueId = ticket?.queue.id ?? entryPoint?.queue?.id else {
            startPolling()
            return
        }

        let channel = RealtimeChannel(
            supabaseURL: url,
            apiKey: credentials.apiKey,
            queueId: queueId,
            onState: { [weak self] state in
                Task { @MainActor in
                    self?.connection = state
                    if state == .joined { await self?.refresh() }
                }
            },
            onMessage: { [weak self] data in
                guard let state = try? JSONDecoder().decode(PublicQueueState.self, from: data) else { return }
                Task { @MainActor in self?.apply(state: state) }
            }
        )
        self.channel = channel
        channel.connect()
        startPolling()
    }

    /// Filet de sécurité : même en temps réel, on resynchronise
    /// périodiquement. Un client debout dans un salon ne rafraîchit pas.
    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                // Cadence adaptative : rare quand le canal tient, serrée
                // quand il est tombé. Un client debout dans un salon ne
                // rafraîchit jamais lui-même.
                let seconds: UInt64 = (self?.connection == .joined) ? 60 : 12
                try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
                guard !Task.isCancelled else { return }
                await self?.refresh()
            }
        }
    }

    public func teardown() {
        channel?.stop()
        channel = nil
        pollTask?.cancel()
        pollTask = nil
        connection = .idle
    }

    // MARK: - Notifications

    private func registerForPush() async {
        guard let point = entryPoint,
              let invocationURL,
              let token = store.effectiveToken(organizationId: point.organization.id) else { return }

        let manager = NotificationManager.shared
        let deviceToken = await manager.requestAuthorizationAndToken()

        do {
            let response = try await api.registerAppClipSession(
                organizationId: point.organization.id,
                locationId: point.location.id,
                invocationURL: invocationURL.absoluteString,
                deviceToken: deviceToken,
                authorizationStatus: manager.authorizationLabel,
                token: token
            )
            // On n'annonce au client qu'il sera prévenu QUE si le serveur
            // confirme qu'il peut réellement pousser.
            manager.markPushConfirmed(response.pushAvailable)
        } catch {
            manager.markPushConfirmed(false)
        }
    }

    // MARK: - Application de l'état

    private func apply(ticket: TicketState) {
        let previousAhead = self.ticket?.entry.peopleAhead
        self.ticket = ticket
        self.waitingCount = ticket.queue.waiting

        // Un ticket terminé ne doit jamais bloquer l'App Clip sur
        // "Merci pour votre visite" au prochain lancement. On garde
        // l'écran de fin pour le lancement courant, mais on oublie
        // immédiatement l'identifiant persistant du ticket.
        if ticket.entry.status == .completed {
            store.rememberEntry(nil)
        } else {
            store.rememberEntry(ticket.entry.id)
        }

        if let previousAhead, ticket.entry.peopleAhead < previousAhead {
            Haptics.advance(reachedTurn: ticket.entry.peopleAhead == 0)
        }
        phase = Self.phase(for: ticket)
    }

    private func apply(state: PublicQueueState) {
        waitingCount = state.waiting
        servingCount = state.serving

        guard let current = ticket else { return }

        if let mine = state.entries.first(where: { $0.id == current.entry.id }) {
            guard mine.ahead != current.entry.peopleAhead || mine.status != current.entry.status else { return }
            if mine.ahead < current.entry.peopleAhead {
                Haptics.advance(reachedTurn: mine.ahead == 0)
            }
            let updated = TicketState(
                entry: ClientEntry(
                    id: current.entry.id,
                    name: current.entry.name,
                    status: mine.status,
                    peopleAhead: mine.ahead,
                    joinedAt: current.entry.joinedAt,
                    calledAt: current.entry.calledAt,
                    returningAt: current.entry.returningAt,
                    serviceStartedAt: current.entry.serviceStartedAt,
                    completedAt: current.entry.completedAt,
                    staffName: current.entry.staffName
                ),
                queue: QueueInfo(
                    id: current.queue.id, status: state.status,
                    name: current.queue.name, pauseReason: current.queue.pauseReason,
                    waiting: state.waiting
                ),
                location: current.location
            )
            ticket = updated
            phase = Self.phase(for: updated)
            return
        }

        // Le ticket a quitté la file active : on recharge pour connaître
        // l'issue exacte et, le cas échéant, récupérer le lien d'avis.
        if state.closedEntries.contains(where: { $0.id == current.entry.id }) {
            Task { await refresh() }
        }
    }

    private static func phase(for ticket: TicketState) -> Phase {
        switch ticket.entry.status {
        case .completed: return .done
        case .serving, .next: return .turn
        case .cancelled, .expired, .skipped, .absent: return .closed
        default: return ticket.entry.peopleAhead == 0 ? .turn : .queued
        }
    }

    // MARK: - URL d'invocation

    /// Extrait le code de plaque de `https://domaine/e/{code}`.
    public static func slug(from url: URL) -> String? {
        let parts = url.path.split(separator: "/").map(String.init)
        guard parts.count >= 2, parts[0] == "e" else { return nil }
        let candidate = parts[1].lowercased()
        let pattern = "^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$"
        guard candidate.range(of: pattern, options: .regularExpression) != nil else { return nil }
        return candidate
    }
}
