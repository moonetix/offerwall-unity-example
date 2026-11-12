using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

namespace MoonetixDemo
{
    // Demo sign-in against the server in server/. Replace it with your own accounts.
    // The game keeps only a random sign-in token. It never holds the API key or the postback key.
    public class PlayerAccount : MonoBehaviour
    {
        [Tooltip("Your server, for example https://game.example.com. Use https in release builds.")]
        [SerializeField] private string serverUrl = "http://127.0.0.1:3000";

        private const string TokenKey = "moonetix_demo_player_token";

        [Serializable]
        private class PlayerResponse
        {
            public string token = "";
        }

        public string Token { get; private set; } = "";

        public bool SignedIn
        {
            get { return !string.IsNullOrEmpty(Token); }
        }

        void Awake()
        {
            Token = PlayerPrefs.GetString(TokenKey, "");
        }

        public string Url(string path)
        {
            return serverUrl.TrimEnd('/') + path;
        }

        public void Authorize(UnityWebRequest request)
        {
            request.SetRequestHeader("Authorization", "Bearer " + Token);
        }

        // Creates a guest player. Call it only after the player confirmed they are 16 or older.
        public IEnumerator CreatePlayer(Action<bool> done)
        {
            WWWForm form = new WWWForm();
            form.AddField("age_confirmed", "true");
            using (UnityWebRequest request = UnityWebRequest.Post(Url("/api/players"), form))
            {
                request.timeout = 15;
                yield return request.SendWebRequest();
                PlayerResponse response = null;
                if (request.result == UnityWebRequest.Result.Success)
                {
                    try
                    {
                        response = JsonUtility.FromJson<PlayerResponse>(request.downloadHandler.text);
                    }
                    catch (ArgumentException)
                    {
                    }
                }
                if (response == null || string.IsNullOrEmpty(response.token))
                {
                    done(false);
                    yield break;
                }
                Token = response.token;
                PlayerPrefs.SetString(TokenKey, Token);
                PlayerPrefs.Save();
                done(true);
            }
        }

        // The server no longer knows the token, for example after a database reset.
        public void SignOut()
        {
            Token = "";
            PlayerPrefs.DeleteKey(TokenKey);
        }
    }
}
