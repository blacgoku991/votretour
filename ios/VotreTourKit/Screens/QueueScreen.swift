import SwiftUI

/// Écran « vous êtes dans la file ».
///
/// Une seule information compte : combien de personnes sont devant.
/// Pas de numéro de ticket, pas de temps estimé — deux promesses qu'on
/// ne peut pas tenir honnêtement et qui angoissent plus qu'elles
/// n'aident.
struct QueueScreen: View {

    @ObservedObject var model: QueueModel
    @ObservedObject var notifications: NotificationManager
    @State private var confirmLeave = false

    private var ticket: TicketState? { model.ticket }
    private var accent: Color { VT.Color.accent(model.entryPoint?.settings.brandAccent ?? "signal") }
    private var isTurn: Bool { model.phase == .turn }
    private var isReturning: Bool { ticket?.entry.status == .returning }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: VT.Space.x5) {
                header
                countBlock

                RangView(
                    ahead: ticket?.entry.peopleAhead ?? 0,
                    selfLabel: ticket?.entry.name,
                    selfHint: isTurn ? "À vous"
                        : isReturning ? "Vous revenez"
                        : ticket?.entry.staffName ?? "Votre place",
                    headIsServing: model.servingCount > 0,
                    accent: accent
                )

                notificationNotice

                if let message = model.errorMessage {
                    Text(message)
                        .font(VT.Type.body(14))
                        .foregroundStyle(VT.Color.brique)
                }

                actions
            }
            .padding(VT.Space.x5)
        }
    }

    // MARK: - Morceaux

    private var header: some View {
        HStack(spacing: VT.Space.x3) {
            LogoBadge(name: ticket?.location.name ?? "")
            VStack(alignment: .leading, spacing: 2) {
                Text(ticket?.location.name ?? "")
                    .font(VT.Type.strong(17))
                    .foregroundStyle(VT.Color.text)
                    .lineLimit(2)
                if let city = ticket?.location.city {
                    Text(city)
                        .font(VT.Type.body(12))
                        .foregroundStyle(VT.Color.textFaint)
                }
            }
            Spacer(minLength: 0)
            HStack(spacing: 6) {
                VTPip(model.connection == .joined ? .live
                      : model.connection == .disconnected ? .off : .warn)
                Text(connectionLabel)
                    .font(VT.Type.body(12))
                    .foregroundStyle(VT.Color.textFaint)
            }
        }
    }

    private var connectionLabel: String {
        switch model.connection {
        case .joined: return "En direct"
        case .connecting: return "Connexion…"
        case .disconnected: return "Reconnexion…"
        case .idle: return "Suivi actif"
        }
    }

    @ViewBuilder
    private var countBlock: some View {
        VStack(spacing: VT.Space.x2) {
            if isTurn {
                Text("C'est")
                    .font(VT.Type.body(18))
                    .foregroundStyle(.white.opacity(0.78))
                Text("votre tour")
                    .font(VT.Type.display(46))
                    .foregroundStyle(.white)
                Text("PRÉSENTEZ-VOUS AU COMPTOIR")
                    .font(VT.Type.label(12))
                    .tracking(2)
                    .foregroundStyle(.white.opacity(0.82))
            } else {
                FlapNumberView(value: ticket?.entry.peopleAhead ?? 0, size: 108)
                Text((ticket?.entry.peopleAhead ?? 0) == 1
                     ? "personne devant vous" : "personnes devant vous")
                    .font(VT.Type.label(12))
                    .tracking(2)
                    .foregroundStyle(VT.Color.textMuted)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, VT.Space.x7)
        .padding(.horizontal, VT.Space.x4)
        .background(
            RoundedRectangle(cornerRadius: VT.Radius.card, style: .continuous)
                .fill(isTurn ? accent : VT.Color.surfaceRaised)
                .overlay(
                    RoundedRectangle(cornerRadius: VT.Radius.card, style: .continuous)
                        .stroke(isTurn ? .clear : VT.Color.line, lineWidth: 1)
                )
                .shadow(color: isTurn ? accent.opacity(0.5) : .clear, radius: 28, x: 0, y: 14)
        )
        .animation(VT.Motion.slat, value: isTurn)
    }

    /// On ne promet jamais une notification qu'on ne peut pas envoyer :
    /// la phrase affichée reflète l'autorisation réelle ET la confirmation
    /// du serveur.
    private var notificationNotice: some View {
        HStack(spacing: VT.Space.x3) {
            Image(systemName: notifications.pushConfirmed ? "bell.fill" : "bell")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(notifications.pushConfirmed ? "Vous serez prévenu" : "Suivi à l'écran")
                    .font(VT.Type.strong(15))
                    .foregroundStyle(VT.Color.text)
                Text(notifications.statusSentence)
                    .font(VT.Type.body(12))
                    .foregroundStyle(VT.Color.textFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(VT.Space.x4)
        .background(
            RoundedRectangle(cornerRadius: VT.Radius.field, style: .continuous)
                .fill(VT.Color.surfaceRaised)
                .overlay(
                    RoundedRectangle(cornerRadius: VT.Radius.field, style: .continuous)
                        .stroke(VT.Color.line, lineWidth: 1)
                )
        )
    }

    private var actions: some View {
        VStack(spacing: VT.Space.x3) {
            if isTurn {
                if let url = directionsURL {
                    Link(destination: url) {
                        Text("Ouvrir l'itinéraire")
                            .font(VT.Type.strong(17))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, minHeight: 58)
                            .background(accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                }
            } else {
                VTPrimaryButton(
                    isReturning ? "Le salon sait que vous revenez" : "Je suis de retour",
                    isLoading: model.isBusy
                ) {
                    Task { await model.markReturning() }
                }
                .disabled(isReturning)
                .opacity(isReturning ? 0.6 : 1)
            }

            HStack(spacing: VT.Space.x2) {
                if let url = directionsURL {
                    Link(destination: url) {
                        Text("Itinéraire")
                            .font(VT.Type.strong(15))
                            .foregroundStyle(VT.Color.text)
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .background(
                                RoundedRectangle(cornerRadius: VT.Radius.field, style: .continuous)
                                    .stroke(VT.Color.lineStrong, lineWidth: 1)
                            )
                    }
                }
                if let phone = ticket?.location.phone,
                   let url = URL(string: "tel://\(phone.filter { $0.isNumber || $0 == "+" })") {
                    Link(destination: url) {
                        Text("Appeler")
                            .font(VT.Type.strong(15))
                            .foregroundStyle(VT.Color.text)
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .background(
                                RoundedRectangle(cornerRadius: VT.Radius.field, style: .continuous)
                                    .stroke(VT.Color.lineStrong, lineWidth: 1)
                            )
                    }
                }
            }

            if model.entryPoint?.settings.allowClientLeave != false {
                if confirmLeave {
                    HStack(spacing: VT.Space.x2) {
                        VTSecondaryButton("Confirmer", role: .destructive) {
                            Task { await model.leaveQueue() }
                        }
                        VTSecondaryButton("Annuler") { confirmLeave = false }
                    }
                } else {
                    Button("Quitter la file") { confirmLeave = true }
                        .font(VT.Type.body(14))
                        .foregroundStyle(VT.Color.textFaint)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
        }
    }

    private var directionsURL: URL? {
        guard let location = ticket?.location else { return nil }
        if let maps = location.mapsUrl, let url = URL(string: maps) { return url }
        if let latitude = location.latitude, let longitude = location.longitude {
            return URL(string: "http://maps.apple.com/?daddr=\(latitude),\(longitude)&dirflg=w")
        }
        let address = [location.name, location.addressLine1, location.postalCode, location.city]
            .compactMap { $0 }.joined(separator: " ")
        let encoded = address.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return URL(string: "http://maps.apple.com/?daddr=\(encoded)")
    }
}
