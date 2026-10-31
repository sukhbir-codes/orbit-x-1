import torch
import torch.nn as nn
import numpy as np

class RiskSurrogateNN(nn.Module):
    def __init__(self):
        super(RiskSurrogateNN, self).__init__()
        self.net = nn.Sequential(
            nn.Linear(4, 32),
            nn.SiLU(),
            nn.Linear(32, 32),
            nn.SiLU(),
            nn.Linear(32, 1),
            nn.Sigmoid()
        )

    def forward(self, x):
        return self.net(x)

def generate_and_export():
    print("[*] Generating synthetic orbital conjunction dataset...")
    np.random.seed(42)
    torch.manual_seed(42)
    N = 25000
    miss_dist = np.random.uniform(0.01, 15.0, (N, 1)).astype(np.float32)
    rel_vel = np.random.uniform(5.0, 16.0, (N, 1)).astype(np.float32)
    hard_body_rad = np.random.uniform(0.1, 5.0, (N, 1)).astype(np.float32)
    tca = np.random.uniform(60.0, 3600.0, (N, 1)).astype(np.float32)

    X_train = np.hstack([miss_dist, rel_vel, hard_body_rad, tca])
    sigma = 0.55 + 0.05 * (tca / 600.0)
    exponent = -(miss_dist ** 2) / (2.0 * (sigma ** 2))
    y_train = np.clip(np.exp(exponent) * (hard_body_rad / 2.0), 1e-7, 0.999).astype(np.float32)

    X_tensor = torch.tensor(X_train)
    y_tensor = torch.tensor(y_train)

    model = RiskSurrogateNN()
    criterion = nn.MSELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=0.005)

    print("[*] Training PyTorch Neural Surrogate...")
    model.train()
    for epoch in range(120):
        optimizer.zero_grad()
        out = model(X_tensor)
        loss = criterion(out, y_tensor)
        loss.backward()
        optimizer.step()

    print(f"[*] Training complete. Final Loss: {loss.item():.6f}")

    dummy_input = torch.randn(1, 4, dtype=torch.float32)
    onnx_file = "risk_surrogate.onnx"
    torch.onnx.export(
        model,
        dummy_input,
        onnx_file,
        input_names=["conjunction_features"],
        output_names=["collision_probability"],
        dynamic_axes={"conjunction_features": {0: "batch_size"}, "collision_probability": {0: "batch_size"}},
        opset_version=14
    )
    print(f"[✔] Successfully exported model to {onnx_file}")

if __name__ == "__main__":
    generate_and_export()
