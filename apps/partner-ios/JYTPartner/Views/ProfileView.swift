import SwiftUI

struct ProfileView: View {
  @EnvironmentObject private var auth: AuthStore

  var body: some View {
    NavigationStack {
      List {
        if let me = auth.partnerMe {
          Section {
            HStack(spacing: 14) {
              ZStack {
                Circle().fill(Color.accentColor.opacity(0.15))
                Text(String(me.displayName.prefix(1)).uppercased())
                  .font(.title2.weight(.bold))
                  .foregroundStyle(Color.accentColor)
              }
              .frame(width: 52, height: 52)
              VStack(alignment: .leading, spacing: 2) {
                Text(me.displayName).font(.body.weight(.semibold))
                if let email = me.admin?.email {
                  Text(email).font(.footnote).foregroundStyle(.secondary)
                }
                if let role = me.admin?.role {
                  Text("Role: \(role)").font(.footnote).foregroundStyle(.secondary)
                }
              }
            }
            .padding(.vertical, 4)
          }
        }

        Section {
          Button(role: .destructive) {
            // Sign-out also unregisters the device so a signed-out phone
            // stops receiving this partner's pushes.
            PushManager.shared.unregisterCurrentDevice()
            auth.logout()
          } label: {
            Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
          }
        }

        Section {
          Text("More partner surfaces (production runs, inventory, payouts) land here as they come over from the web app.")
            .font(.footnote)
            .foregroundStyle(.tertiary)
        }
      }
      .navigationTitle("Profile")
    }
  }
}
