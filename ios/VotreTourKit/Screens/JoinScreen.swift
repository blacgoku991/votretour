import SwiftUI

/// Écran d'accueil : rejoindre la file.
///
/// Le parcours entier tient ici. Pas de compte, pas de mot de passe,
/// pas d'e-mail, pas de SMS. Au maximum un prénom — et seulement si
/// l'établissement l'a demandé.
struct JoinScreen: View {

    @ObservedObject var model: QueueModel
    @FocusState private var nameFocused: Bool

    private var point: EntryPoint? { model.entryPoint }
    private var queue: EntryPointQueue? { point?.queue }
    private var accent: Color { VT.Color.accent(point?.settings.brandAccent ?? "signal") }
    private var isOpen: Bool { queue?.status == .open }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: VT.Space.x5) {
                header

                countBlock

                if !isOpen {
                    unavailableBanner
                } else {
                    if queue?.askClientName == true { nameField }
                    if showsStaffChoice { staffChooser }
                    if showsServices { serviceChooser }

                    if let message = model.errorMessage {
                        Text(message)
                            .font(VT.Type.body(14))
                            .foregroundStyle(VT.Color.brique)
                    }

                    VTPrimaryButton("Rejoindre la file", isLoading: model.isBusy) {
                        nameFocused = false
                        Task { await model.join() }
                    }
                    .disabled(queue?.clientNameRequired == true
                              && model.name.trimmingCharacters(in: .whitespaces).isEmpty)

                    Text("Pas de compte, rien à installer, pas de SMS.\nVous pourrez partir et revenir quand ce sera votre tour.")
                        .font(VT.Type.body(12))
                        .foregroundStyle(VT.Color.textFaint)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.top, VT.Space.x1)
                }
            }
            .padding(VT.Space.x5)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: - Morceaux

    private var header: some View {
        HStack(spacing: VT.Space.x3) {
            LogoBadge(name: point?.location.name ?? "")
            VStack(alignment: .leading, spacing: 2) {
                Text(point?.location.name ?? "")
                    .font(VT.Type.strong(17))
                    .foregroundStyle(VT.Color.text)
                    .lineLimit(2)
                if let city = point?.location.city {
                    Text(city)
                        .font(VT.Type.body(12))
                        .foregroundStyle(VT.Color.textFaint)
                }
            }
            Spacer(minLength: 0)
            HStack(spacing: 6) {
                VTPip(isOpen ? .live : .warn)
                Text(isOpen ? "File ouverte" : queue?.status == .paused ? "En pause" : "Fermée")
                    .font(VT.Type.body(12))
                    .foregroundStyle(VT.Color.textFaint)
            }
        }
    }

    private var countBlock: some View {
        VStack(spacing: VT.Space.x2) {
            FlapNumberView(value: model.waitingCount, size: 92)
            Text(model.waitingCount == 1 ? "personne dans la file" : "personnes dans la file")
                .font(VT.Type.label(12))
                .tracking(2)
                .foregroundStyle(VT.Color.textMuted)

            if model.waitingCount > 0 {
                RangPreview(count: min(model.waitingCount, 5))
                    .frame(maxWidth: 190)
                    .padding(.top, VT.Space.x3)
                    .opacity(0.85)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, VT.Space.x7)
        .padding(.horizontal, VT.Space.x4)
        .background(
            RoundedRectangle(cornerRadius: VT.Radius.card, style: .continuous)
                .fill(VT.Color.surfaceRaised)
                .overlay(
                    RoundedRectangle(cornerRadius: VT.Radius.card, style: .continuous)
                        .stroke(VT.Color.line, lineWidth: 1)
                )
        )
    }

    private var unavailableBanner: some View {
        Text(queue?.status == .paused
             ? (queue?.pauseReason.map { "File en pause : \($0)" }
                ?? "La file est momentanément en pause. Réessayez dans quelques minutes.")
             : "La file est fermée pour le moment. Présentez-vous au comptoir.")
            .font(VT.Type.body(14))
            .foregroundStyle(VT.Color.copper)
            .padding(VT.Space.x4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: VT.Radius.field, style: .continuous)
                    .fill(VT.Color.copper.opacity(0.16))
            )
    }

    private var nameField: some View {
        VStack(alignment: .leading, spacing: VT.Space.x2) {
            VTLabel(queue?.clientNameRequired == true ? "Prénom" : "Prénom (facultatif)")
            TextField("Pour vous appeler", text: $model.name)
                .font(VT.Type.body(17))
                .foregroundStyle(VT.Color.text)
                .textContentType(.givenName)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .focused($nameFocused)
                .padding(.horizontal, VT.Space.x4)
                .frame(height: 52)
                .background(
                    RoundedRectangle(cornerRadius: VT.Radius.field, style: .continuous)
                        .fill(VT.Color.surfaceRaised)
                        .overlay(
                            RoundedRectangle(cornerRadius: VT.Radius.field, style: .continuous)
                                .stroke(nameFocused ? accent : VT.Color.lineStrong, lineWidth: 1)
                        )
                )
                .onSubmit { Task { await model.join() } }
        }
    }

    private var showsStaffChoice: Bool {
        guard point?.plate?.staffId == nil, let queue else { return false }
        return (queue.allowStaffChoice || queue.mode == "per_staff") && !(point?.staff.isEmpty ?? true)
    }

    private var staffChooser: some View {
        VStack(alignment: .leading, spacing: VT.Space.x2) {
            VTLabel("Avec qui ?")
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: VT.Space.x2) {
                ChoiceCard(
                    title: "Peu importe",
                    subtitle: "Le prochain disponible",
                    isSelected: model.selectedStaffId == nil,
                    accent: accent
                ) { model.selectedStaffId = nil }

                ForEach(point?.staff ?? []) { member in
                    ChoiceCard(
                        title: member.name,
                        subtitle: member.onBreak ? "En pause"
                            : member.waiting == 0 ? "Disponible"
                            : "\(member.waiting) en attente",
                        isSelected: model.selectedStaffId == member.id,
                        accent: VT.Color.accent(member.accent)
                    ) { model.selectedStaffId = member.id }
                }
            }
        }
    }

    private var showsServices: Bool {
        queue?.allowServiceChoice == true && !(point?.services.isEmpty ?? true)
    }

    private var serviceChooser: some View {
        VStack(alignment: .leading, spacing: VT.Space.x2) {
            VTLabel("Prestation")
            Menu {
                Button("Je verrai sur place") { model.selectedServiceId = nil }
                ForEach(point?.services ?? []) { service in
                    Button(service.durationMinutes.map { "\(service.name) — \($0) min" } ?? service.name) {
                        model.selectedServiceId = service.id
                    }
                }
            } label: {
                HStack {
                    Text(selectedServiceName)
                        .font(VT.Type.body(16))
                        .foregroundStyle(VT.Color.text)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(VT.Color.textFaint)
                }
                .padding(.horizontal, VT.Space.x4)
                .frame(height: 52)
                .background(
                    RoundedRectangle(cornerRadius: VT.Radius.field, style: .continuous)
                        .fill(VT.Color.surfaceRaised)
                        .overlay(
                            RoundedRectangle(cornerRadius: VT.Radius.field, style: .continuous)
                                .stroke(VT.Color.lineStrong, lineWidth: 1)
                        )
                )
            }
        }
    }

    private var selectedServiceName: String {
        guard let id = model.selectedServiceId,
              let service = point?.services.first(where: { $0.id == id }) else {
            return "Je verrai sur place"
        }
        return service.name
    }
}

// MARK: - Éléments

struct ChoiceCard: View {
    let title: String
    let subtitle: String
    let isSelected: Bool
    let accent: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(VT.Type.strong(15))
                    .foregroundStyle(VT.Color.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(VT.Type.body(11))
                    .foregroundStyle(VT.Color.textFaint)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, VT.Space.x4)
            .padding(.vertical, VT.Space.x3)
            .frame(minHeight: 62)
            .background(
                RoundedRectangle(cornerRadius: VT.Radius.field, style: .continuous)
                    .fill(isSelected ? accent.opacity(0.14) : VT.Color.surfaceRaised)
                    .overlay(
                        RoundedRectangle(cornerRadius: VT.Radius.field, style: .continuous)
                            .stroke(isSelected ? accent : VT.Color.lineStrong, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(PressableStyle())
    }
}

struct LogoBadge: View {
    let name: String

    private var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first }.map(String.init).joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }

    var body: some View {
        Text(initials)
            .font(VT.Type.label(13))
            .tracking(0.5)
            .foregroundStyle(VT.Color.textMuted)
            .frame(width: 40, height: 40)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(VT.Color.surfaceRaised)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(VT.Color.line, lineWidth: 1)
                    )
            )
    }
}

/// Aperçu statique de la file sur l'écran d'accueil.
struct RangPreview: View {
    let count: Int

    var body: some View {
        VStack(alignment: .leading, spacing: VT.Rang.gap) {
            ForEach(0..<count, id: \.self) { index in
                RoundedRectangle(cornerRadius: VT.Radius.slat, style: .continuous)
                    .fill(VT.Color.slat)
                    .frame(height: VT.Rang.slatHeight)
                    .opacity(1 - Double(index) * 0.12)
            }
        }
    }
}
