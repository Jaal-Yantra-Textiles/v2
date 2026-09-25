import SwiftUI

struct LoginView: View {
  @EnvironmentObject private var auth: AuthStore
  @State private var email = ""
  @State private var password = ""
  @State private var submitting = false
  @State private var errorText: String?

  var body: some View {
    VStack(spacing: 24) {
      Spacer()

      VStack(spacing: 10) {
        Image(systemName: "shirt")
          .font(.system(size: 44))
          .foregroundStyle(Color.accentColor)
          .frame(width: 84, height: 84)
          .background(Color.accentColor.opacity(0.12))
          .clipShape(RoundedRectangle(cornerRadius: 20))
        Text("JYT Partner")
          .font(.largeTitle.bold())
        Text("Sign in to manage your design orders and production work.")
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
          .padding(.horizontal, 32)
      }

      VStack(spacing: 14) {
        VStack(alignment: .leading, spacing: 6) {
          Text("Email").font(.caption).foregroundStyle(.secondary)
          TextField("you@example.com", text: $email)
            .textInputAutocapitalization(.never)
            .keyboardType(.emailAddress)
            .autocorrectionDisabled()
            .padding(12)
            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 10))
        }
        VStack(alignment: .leading, spacing: 6) {
          Text("Password").font(.caption).foregroundStyle(.secondary)
          SecureField("••••••••", text: $password)
            .padding(12)
            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 10))
        }
        if let errorText {
          Text(errorText)
            .font(.footnote)
            .foregroundStyle(.red)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        Button {
          signIn()
        } label: {
          Group {
            if submitting {
              ProgressView().tint(.white)
            } else {
              Text("Sign in").fontWeight(.semibold)
            }
          }
          .frame(maxWidth: .infinity)
          .padding(.vertical, 6)
        }
        .buttonStyle(.borderedProminent)
        .disabled(submitting)
      }
      .padding(20)
      .background(
        RoundedRectangle(cornerRadius: 20)
          .fill(Color(.secondarySystemBackground))
      )
      .padding(.horizontal, 24)

      Spacer()
    }
    .animation(.easeOut(duration: 0.15), value: errorText)
  }

  private func signIn() {
    guard !submitting else { return }
    errorText = nil
    let email = email.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !email.isEmpty, !password.isEmpty else {
      errorText = "Enter your email and password."
      return
    }
    submitting = true
    Task {
      defer { submitting = false }
      do {
        try await auth.login(email: email, password: password)
      } catch {
        errorText = (error as? LocalizedError)?.errorDescription
          ?? "Could not sign in. Check your connection and try again."
      }
    }
  }
}
