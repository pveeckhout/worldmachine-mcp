# World Machine 4067 (Dragontail Peak), Linux AppImage: Pro licence needs re-activation whenever the Wi-Fi MAC changes

## Environment

- World Machine build 4067 (Dragontail Peak), Pro licence, x64-AVX2 Linux AppImage, Fedora 44.
- NetworkManager with Fedora's default Wi-Fi settings: `wifi.cloned-mac-address=stable-ssid` (`/usr/lib/NetworkManager/conf.d/22-wifi-mac-addr.conf`, shipped since NetworkManager 1.45) and MAC randomisation while scanning.
- One Wi-Fi interface (`wlo1`); the other interfaces are virtual (Docker bridges and veths, Tailscale, WireGuard).

## Symptom

At irregular intervals, the licence checkout fails at startup:

```
[Error      ] License Manager.Checkout: License checkout failed for product wmpro
[Error      ] License Manager.RLM Details: Wrong host for license (-4)
Wrong host (-193): rehostable not on reference hostid
[Info       ] Startup: License manager checkout (LICENSE_RESULT 3)
[Info       ] Startup: License Activation
[Info       ] License Manager.Activate: Reference hostID is (invalid)
[Warning    ] License Manager.Activate: Rehostable HostID already exists.
[Info       ] License Manager.Activate: Attempting activation with existing hostiD (...)
... Activation successful but license is invalid on this machine. Attempting hard revoke
... Revoked existing fulfillment for this machine. / Activation successful (code 0)
[Info       ] License Manager.Checkout: License checkout successful (product wmpro)
```

Sometimes World Machine re-activates by itself within a few seconds, as above. Other times the activation dialog opens and the activation has to be completed by hand. Each time, `worldmachine_license.lic` is re-issued and `/var/tmp/worldmchn/wmpro` is recreated.

## Cause (from local evidence)

The rehostable hostid's reference hostid appears to be the current MAC address of the first network interface that has one (here `wlo1`). Fedora's NetworkManager deliberately changes that address:

- `stable-ssid` gives each Wi-Fi network its own MAC address;
- while the Wi-Fi is disconnected and scanning, NetworkManager sets a new random MAC address every few minutes.

The hardware address (`permaddr`, shown by `ip link show wlo1`) never changes, but it is not what the interface reports.

Over three days, all five licence failures or silent re-activations came right after `wlo1`'s MAC address had changed since the last activation:

| Start | `wlo1` MAC at the last activation → at this start | Result |
|---|---|---|
| day 1, morning | network A → network B | activation needed |
| day 1, evening | network B → network A | first start failed, the retry passed |
| day 2, 09:07 | network A → random scanning MAC (Wi-Fi not connected yet) | re-activated by itself |
| day 2, 18:06 | random scanning MAC → network A | activation dialog |
| day 3, morning | network A → network B | licence re-issued |

Other distributions and iwd randomise MAC addresses the same way, and Windows and macOS have similar privacy features.

## Steps to reproduce

1. Activate World Machine while connected to Wi-Fi network A, then quit.
2. Connect to Wi-Fi network B (with `stable-ssid`, the MAC address changes).
3. Start World Machine: the checkout fails with `rehostable not on reference hostid`.

Alternatively, start World Machine while the Wi-Fi is disconnected and scanning.

## Expected

A licence activated on a machine stays valid on that machine, whichever network it joins.

## Requests (any one would fix it)

- Use a reference that MAC privacy does not change: the permanent hardware address (`IFLA_PERM_ADDRESS` over netlink, or the `ETHTOOL_GPERMADDR` ioctl), `/etc/machine-id`, or a disk identifier.
- Turn off the RLM reference-hostid check for the rehostable licence (`rlm_isv_cfg_disable_reference_hostid_check()`), or set a stable reference hostid explicitly (supported since RLM v12.3), as described in Reprise's [License Rehosting](https://docs.reprisesoftware.com/docs/actpro/license-rehosting.html) documentation.
- At minimum, say why in the activation dialog ("the network hardware ID changed") and document the workaround below.

## Workaround

Make NetworkManager use the hardware address on Wi-Fi. This costs Wi-Fi privacy: the machine becomes recognisable across the networks it joins.

```
sudo tee /etc/NetworkManager/conf.d/90-wifi-permanent-mac.conf <<'EOF'
[connection.90-wifi-permanent-mac]
match-device=type:wifi
wifi.cloned-mac-address=permanent

[device.90-wifi-permanent-mac]
match-device=type:wifi
wifi.scan-rand-mac-address=no
EOF
sudo systemctl restart NetworkManager
```

The first start after this change re-activates once (the MAC address changed one last time).
