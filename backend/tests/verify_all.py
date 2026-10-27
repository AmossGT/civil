import json
import urllib.request
import urllib.error
import time

BASE_URL = "http://localhost:8000/api/v1"

def req(path, method="GET", body=None, token=None, content_type="application/json"):
    url = f"{BASE_URL}{path}"
    headers = {}
    data = None
    if body is not None:
        if content_type == "application/json":
            data = json.dumps(body).encode("utf-8")
        else:
            data = body
        headers["Content-Type"] = content_type
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request) as resp:
            raw = resp.read()
            if not raw:
                return resp.status, None
            try:
                return resp.status, json.loads(raw.decode("utf-8"))
            except Exception:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode("utf-8"))
        except Exception:
            return e.code, raw

def run_tests():
    print("=== OpenTender Verification Test Suite ===")

    # 1. Health check
    status, data = req("/health")
    assert status in (200, 201) and data.get("status") == "ok", f"Health check failed: {status}, {data}"
    print("[PASS] 1. Health check ok")

    # 2. Admin Login
    admin_creds = {
        "email": "admin@example.gov.in",
        "password": "change-this-local-password"
    }
    status, auth_data = req("/auth/login", method="POST", body=admin_creds)
    assert status in (200, 201), f"Admin login failed: {status}, {auth_data}"
    assert "access_token" in auth_data, "No access_token returned"
    admin_token = auth_data["access_token"]
    refresh_token = auth_data.get("refresh_token")
    print("[PASS] 2. Admin login successful (JWT received)")

    # 3. Token Refresh
    status, refresh_data = req("/auth/refresh", method="POST", body={"refresh_token": refresh_token})
    assert status in (200, 201), f"Token refresh failed: {status}, {refresh_data}"
    assert "access_token" in refresh_data, "No new access_token returned"
    admin_token = refresh_data["access_token"]  # update with rotated token
    print("[PASS] 3. Token refresh successful")

    # 4. User Provisioning (Department Viewer)
    viewer_email = f"viewer_dept1@example.gov.in"
    # check if viewer already exists
    status, users = req("/admin/users", token=admin_token)
    assert status in (200, 201), f"Failed to list users: {status}, {users}"
    existing_viewer = next((u for u in users if u["email"] == viewer_email), None)
    if not existing_viewer:
        status, new_user = req("/admin/users", method="POST", body={
            "email": viewer_email,
            "password": "viewerpassword1234",
            "role": "department_viewer",
            "department_id": 1
        }, token=admin_token)
        assert status in (200, 201), f"Failed to create department viewer: {status}, {new_user}"
    print("[PASS] 4. User provisioning validation works (department_viewer)")

    # 5. Direct Admin CRUD: Create draft tender, update, set award
    draft_ref = "TEST_REF_DRAFT_001"
    # cleanup if exists
    req(f"/admin/tenders/{draft_ref}", method="DELETE", token=admin_token)

    status, created = req("/admin/tenders", method="POST", body={
        "tender_ref": draft_ref,
        "department_id": 1,
        "title": "Automated Test Draft Tender",
        "description": "Created by verification suite",
        "estimated_value": 4500000.0,
        "status": "draft"
    }, token=admin_token)
    assert status in (200, 201) and created["tender_ref"] == draft_ref, f"Failed to create tender: {status}, {created}"

    # Update tender
    status, updated = req(f"/admin/tenders/{draft_ref}", method="PATCH", body={
        "description": "Updated by verification suite"
    }, token=admin_token)
    assert status in (200, 201) and updated["tender_ref"] == draft_ref, f"Failed to patch tender: {status}, {updated}"

    # Set award
    status, awarded = req(f"/admin/tenders/{draft_ref}/award", method="POST", body={
        "contractor_id": 1,
        "awarded_value": 4200000.0,
        "status": "verified"
    }, token=admin_token)
    assert status in (200, 201) and awarded["award_status"] == "verified", f"Failed to set award: {status}, {awarded}"
    print("[PASS] 5. Admin direct CRUD (create draft, patch, set verified award) successful")

    # 6. Department Viewer Scoped Access
    status, v_auth = req("/auth/login", method="POST", body={
        "email": viewer_email,
        "password": "viewerpassword1234"
    })
    assert status in (200, 201), f"Viewer login failed: {status}, {v_auth}"
    viewer_token = v_auth["access_token"]

    # Viewer can access their department tender
    status, t_detail = req(f"/tenders/{draft_ref}", token=viewer_token)
    assert status in (200, 201), f"Viewer could not access their dept tender: {status}, {t_detail}"

    # Viewer CANNOT access admin CRUD
    status, err = req("/admin/tenders", method="POST", body={
        "tender_ref": "VIEWER_UNAUTHORIZED",
        "department_id": 1,
        "title": "Should be forbidden",
        "status": "draft"
    }, token=viewer_token)
    assert status == 403, f"Expected 403 Forbidden for viewer on admin endpoint, got {status}"
    print("[PASS] 6. Department viewer scoped access and role isolation verified")

    # 7. Public / Citizen visibility filtering
    hidden_ref = "TEST_REF_HIDDEN_DRAFT"
    req(f"/admin/tenders/{hidden_ref}", method="DELETE", token=admin_token)  # cleanup
    status, _ = req("/admin/tenders", method="POST", body={
        "tender_ref": hidden_ref,
        "department_id": 1,
        "title": "Hidden Draft Tender",
        "estimated_value": 1000000.0,
        "status": "draft"
    }, token=admin_token)
    assert status in (200, 201)

    # Public unauthenticated request must get 404 for draft
    status, err = req(f"/tenders/{hidden_ref}")
    assert status == 404, f"Public request should get 404 for draft tender, got {status}"
    print("[PASS] 7. Public unauthenticated access correctly excludes draft tenders (404)")

    # 8. PostGIS Map Bounded Search
    status, map_res = req("/tenders/map?bbox=93.85,24.7,94.02,24.91")
    assert status in (200, 201), f"Map search failed: {status}, {map_res}"
    assert "features" in map_res, "features array missing in map response"
    assert len(map_res["features"]) <= 100, f"Features limit exceeded: {len(map_res['features'])}"
    print(f"[PASS] 8. PostGIS map query bounded: {len(map_res['features'])} features returned (<= 100)")

    # 9. Two-Pass Atomic CSV Import
    boundary = "----TestBoundaryXYZ"
    
    # 9a: Bad CSV with errors
    bad_csv = "tender_ref,department_id,title,estimated_value\nCSV_TEST_01,1,Valid Title,50000\n,1,Missing Ref,60000\nCSV_TEST_03,99999,Bad Dept,70000\n"
    body_bad = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="bad.csv"\r\n'
        f"Content-Type: text/csv\r\n\r\n"
        f"{bad_csv}\r\n"
        f"--{boundary}--\r\n"
    ).encode("utf-8")
    status, bad_res = req("/admin/import/tenders", method="POST", body=body_bad, token=admin_token, content_type=f"multipart/form-data; boundary={boundary}")
    assert status in (200, 201) and bad_res["created"] == 0 and len(bad_res["errors"]) > 0, f"CSV should have rejected bad rows! {bad_res}"

    # 9b: Valid CSV
    valid_csv = "tender_ref,department_id,title,estimated_value\nCSV_GOOD_01,1,Valid Tender One,2500000\nCSV_GOOD_02,1,Valid Tender Two,3500000\n"
    req("/admin/tenders/CSV_GOOD_01", method="DELETE", token=admin_token)
    req("/admin/tenders/CSV_GOOD_02", method="DELETE", token=admin_token)
    body_good = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="good.csv"\r\n'
        f"Content-Type: text/csv\r\n\r\n"
        f"{valid_csv}\r\n"
        f"--{boundary}--\r\n"
    ).encode("utf-8")
    status, good_res = req("/admin/import/tenders", method="POST", body=body_good, token=admin_token, content_type=f"multipart/form-data; boundary={boundary}")
    assert status in (200, 201) and good_res["created"] == 2 and len(good_res["errors"]) == 0, f"Valid CSV import failed: {good_res}"
    print("[PASS] 9. Atomic two-pass CSV import validated (rollback on bad row, commit on valid)")

    # 10. Role-Segregated Dedicated Viewer Endpoints (/viewer/*)
    # Unauthenticated -> 401
    status, _ = req("/viewer/department")
    assert status == 401, f"Unauthenticated request to /viewer/department should return 401, got {status}"
    
    # Viewer -> 200 OK
    status, v_dept = req("/viewer/department", token=viewer_token)
    assert status in (200, 201) and "stats" in v_dept and "officers" in v_dept, f"Viewer department failed: {status}, {v_dept}"

    status, v_tenders = req("/viewer/tenders", token=viewer_token)
    assert status in (200, 201) and "items" in v_tenders, f"Viewer tenders failed: {status}, {v_tenders}"
    print("[PASS] 10. Dedicated role-segregated /viewer/* endpoints verified")

    # 11. Token Revocation on Logout
    status, logout_res = req("/auth/logout", method="POST", token=viewer_token)
    assert status in (200, 201) and logout_res.get("ok") is True

    # Try to use viewer_token again
    status, me_err = req("/auth/me", token=viewer_token)
    assert status == 401, f"Logged out token should be revoked with 401! Got {status}: {me_err}"
    print("[PASS] 11. Instant token revocation on logout verified (token_version bump)")

    # 12. Public tender identifiers for every supplied prototype package
    expected_identifiers = {
        "2024_ADBPW_2403_1": "22/PD/PIU/MUR/PROC-CW/2024/01",
        "2024_ADBPW_2403_2": "22/PD/PIU/MUR/PROC-CW/2024/01",
        "2024_ADBPW_2403_3": "22/PD/PIU/MUR/PROC-CW/2024/01",
        "2024_ADBPW_2403_4": "22/PD/PIU/MUR/PROC-CW/2024/01",
        "2023_ADBPW_2136_1": "22/PD/PIU/IRR/PROC-CW/2022/03",
        "2023_ADBPW_2136_2": "22/PD/PIU/IRR/PROC-CW/2022/03",
        "2023_ADBPW_2136_3": "22/PD/PIU/IRR/PROC-CW/2022/03",
    }
    for tender_ref, expected_reference in expected_identifiers.items():
        status, tender_data = req(f"/tenders/{tender_ref}")
        assert status == 200, f"Tender detail failed for {tender_ref}: {status}, {tender_data}"
        identifiers = tender_data.get("identifiers") or {}
        assert identifiers.get("tender_id") == tender_ref, f"Tender ID mismatch for {tender_ref}: {identifiers}"
        assert identifiers.get("reference_number") == expected_reference, f"Reference number mismatch for {tender_ref}: {identifiers}"
    print("[PASS] 12. Tender ID and reference number are exposed for all seven prototype packages")
    print("\nALL 12 VERIFICATION TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    run_tests()
