using System;
using System.Collections;
using MoonetixOfferwall;
using UnityEngine;
using UnityEngine.Networking;

namespace MoonetixDemo
{
    // Gets a fresh single-use token from your server and opens the Moonetix offerwall with it.
    // Your server calls POST https://api.moonetix.com/v1/session with the API key. The game never sees that key.
    public class EarnButton : MonoBehaviour
    {
        [Tooltip("The App ID from the top of your offerwall's settings page (24 characters). Not the API key.")]
        [SerializeField] private string appId = "YOUR_APP_ID";

        [SerializeField] private PlayerAccount account;

        [Serializable]
        private class TokenResponse
        {
            public string token = "";
        }

        public bool Busy { get; private set; }

        public string Status { get; private set; } = "";

        void Awake()
        {
            Moonetix.Init(appId);
        }

        void OnEnable()
        {
            Moonetix.OnError += HandleError;
        }

        void OnDisable()
        {
            Moonetix.OnError -= HandleError;
        }

        // Call this from the On Click event of a uGUI Button, or from your own UI. CoinHud calls it too.
        public void OpenOfferwall()
        {
            if (!Moonetix.IsSupported)
            {
                Status = "The offerwall opens only in Android and iOS builds.";
                Debug.Log(Status);
                return;
            }
            if (!Busy && account.SignedIn)
            {
                StartCoroutine(FetchTokenAndOpen());
            }
        }

        private IEnumerator FetchTokenAndOpen()
        {
            Busy = true;
            Status = "";
            using (UnityWebRequest request = UnityWebRequest.Post(account.Url("/api/moonetix/session"), new WWWForm()))
            {
                account.Authorize(request);
                request.timeout = 15;
                yield return request.SendWebRequest();
                Busy = false;
                if (request.responseCode == 401)
                {
                    account.SignOut();
                    yield break;
                }
                if (request.responseCode == 403)
                {
                    Status = "Offers are not available for this account.";
                    yield break;
                }
                if (request.result != UnityWebRequest.Result.Success)
                {
                    Status = "Offers are not available right now. Try again later.";
                    Debug.LogWarning("Your server did not return a token: " + request.error);
                    yield break;
                }
                TokenResponse response = null;
                try
                {
                    response = JsonUtility.FromJson<TokenResponse>(request.downloadHandler.text);
                }
                catch (ArgumentException)
                {
                }
                if (response == null || string.IsNullOrEmpty(response.token))
                {
                    Debug.LogWarning("Your server answered without a token.");
                    yield break;
                }
                // A token works once and for 10 minutes, so it is used right away and never stored.
                Moonetix.Open(response.token, new MoonetixOptions(title: "Earn coins"));
            }
        }

        private void HandleError(MoonetixError error)
        {
            Debug.LogWarning(error.CodeName + ": " + error.Message);
            Status = error.Code == MoonetixErrorCode.Network
                ? "No connection. Try again when you are back online."
                : "The offerwall could not open. Tap Earn coins to try again.";
        }
    }
}
