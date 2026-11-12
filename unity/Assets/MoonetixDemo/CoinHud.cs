using System;
using System.Collections;
using MoonetixOfferwall;
using UnityEngine;
using UnityEngine.Networking;

namespace MoonetixDemo
{
    // Coin balance, Earn button and a one-time age check, drawn with IMGUI so no scene setup is needed.
    // Rewards reach your server by postback, never through the game. So the HUD only reads the balance:
    // at start, when the offerwall closes, and when the player returns to the game.
    public class CoinHud : MonoBehaviour
    {
        [SerializeField] private PlayerAccount account;
        [SerializeField] private EarnButton earnButton;

        [Serializable]
        private class BalanceResponse
        {
            public int player_id = 0;
            public string balance = "";
            public string currency = "";
        }

        private string _balanceText = "Coins: -";
        private string _playerText = "";
        private string _message = "";
        private bool _loading;
        private bool _creating;

        void OnEnable()
        {
            Moonetix.OnClosed += Refresh;
        }

        void OnDisable()
        {
            Moonetix.OnClosed -= Refresh;
        }

        void Start()
        {
            Refresh();
        }

        void OnApplicationPause(bool paused)
        {
            if (!paused)
            {
                Refresh();
            }
        }

        public void Refresh()
        {
            if (account.SignedIn && !_loading && isActiveAndEnabled)
            {
                StartCoroutine(LoadBalance());
            }
        }

        private IEnumerator LoadBalance()
        {
            _loading = true;
            using (UnityWebRequest request = UnityWebRequest.Get(account.Url("/api/balance")))
            {
                account.Authorize(request);
                request.timeout = 15;
                yield return request.SendWebRequest();
                _loading = false;
                if (request.responseCode == 401)
                {
                    account.SignOut();
                    yield break;
                }
                if (request.result != UnityWebRequest.Result.Success)
                {
                    yield break;
                }
                BalanceResponse response = null;
                try
                {
                    response = JsonUtility.FromJson<BalanceResponse>(request.downloadHandler.text);
                }
                catch (ArgumentException)
                {
                }
                if (response == null || string.IsNullOrEmpty(response.balance))
                {
                    yield break;
                }
                _balanceText = response.currency + ": " + response.balance;
                _playerText = "Player ID " + response.player_id;
            }
        }

        private void ConfirmAge()
        {
            _creating = true;
            StartCoroutine(account.CreatePlayer(ok =>
            {
                _creating = false;
                _message = ok ? "" : "Could not reach the game server. Try again later.";
                Refresh();
            }));
        }

        void OnGUI()
        {
            float scale = Mathf.Max(1f, Mathf.Min(Screen.width, Screen.height) / 480f);
            GUI.matrix = Matrix4x4.Scale(new Vector3(scale, scale, 1f));
            Rect safe = Screen.safeArea;
            float top = (Screen.height - safe.yMax) / scale;
            GUILayout.BeginArea(new Rect(16f, 16f + top, Screen.width / scale - 32f, Screen.height / scale - 32f - top));

            GUIStyle big = new GUIStyle(GUI.skin.label) { fontSize = 28, fontStyle = FontStyle.Bold };
            GUILayout.Label(account.SignedIn ? _balanceText : "Coins: -", big);
            if (account.SignedIn)
            {
                GUILayout.Label(_playerText);
            }
            GUILayout.Space(12f);

            if (!account.SignedIn)
            {
                GUILayout.Label("Offers are for players 16 or older, with a parent's permission under 18.");
                GUI.enabled = !_creating;
                if (GUILayout.Button("I am 16 or older", GUILayout.Height(48f)))
                {
                    ConfirmAge();
                }
                GUI.enabled = true;
            }
            else
            {
                GUI.enabled = !earnButton.Busy;
                if (GUILayout.Button(earnButton.Busy ? "Opening..." : "Earn coins", GUILayout.Height(56f)))
                {
                    earnButton.OpenOfferwall();
                }
                GUI.enabled = true;
                GUILayout.Label("Rewards arrive after the advertiser confirms the offer. Some take a few minutes.");
            }

            if (!string.IsNullOrEmpty(earnButton.Status))
            {
                GUILayout.Label(earnButton.Status);
            }
            if (!string.IsNullOrEmpty(_message))
            {
                GUILayout.Label(_message);
            }
            GUILayout.EndArea();
        }
    }
}
