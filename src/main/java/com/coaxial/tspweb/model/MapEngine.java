package com.coaxial.tspweb.model;

import com.google.maps.*;
import com.google.maps.errors.ApiException;
import com.google.maps.errors.OverDailyLimitException;
import com.google.maps.model.*;

import javax.swing.*;
import java.awt.*;
import java.io.IOException;
import java.net.URL;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

/**
 * Lớp này quản lý tất cả các kết nối tới các API của Google.
 */
public class MapEngine {
	// private static String key = "AIzaSyCY1PqwBDt9nA2YykeLA-u4XMlrGsyCRVc"; //The
	// google api key
	private static String key = "AIzaSyBBdGpCGqMts05Z6V4Mc29GqghKmtSRVoU"; // The google api key
	private static GeoApiContext context = new GeoApiContext.Builder().apiKey(key).build();
	// api context set up with the api key

	/**
	 * Dịch các Tọa độ đã cho sang Chuỗi, sau đó gọi
	 * {@link MapEngine # getDistances (String [], TravelMode)}.
	 *
	 * @param locations the locations for the distance matrix
	 * @param mode      the travel mode
	 * @return the Distance Matrix
	 */
	public static DistanceMatrixElement[][] getDistances(LatLng[] locations, TravelMode mode) {
		String[] s = new String[locations.length];
		for (int i = 0; i < locations.length; ++i)
			s[i] = locations[i].toUrlValue();
		return getDistances(s, mode);
	}

	/**
	 * Yêu cầu ma trận khoảng cách của các vị trí đã cho từ API ma trận khoảng cách
	 * của Google. Do các giới hạn của API, các yêu cầu lớn được chia thành 2 yêu
	 * cầu duy nhất.
	 *
	 * @param locations the locations for which the distance matrix should be
	 *                  requested
	 * @param mode      the travel mode
	 * @return the distance matrix, stable; may be null if request fails
	 */
	public static DistanceMatrixElement[][] getDistances(String[] locations, TravelMode mode) {
		DistanceMatrixApiRequest req = DistanceMatrixApi.getDistanceMatrix(context,
				locations.length > 10 ? Arrays.copyOfRange(locations, 0, Math.round(locations.length / 2)) : locations,
				locations).mode(mode);
		DistanceMatrixApiRequest req2 = locations.length > 10 ? DistanceMatrixApi
				.getDistanceMatrix(context,
						Arrays.copyOfRange(locations, Math.round(locations.length / 2), locations.length), locations)
				.mode(mode) : null;
		try {
			DistanceMatrix mat = req.await();
			if (req2 != null)
				Thread.sleep(1000);
			DistanceMatrix ma2 = req2 == null ? null : req2.await();

			DistanceMatrixElement[][] toReturn = new DistanceMatrixElement[locations.length][];
			for (int i = 0; i < mat.rows.length; ++i)
				toReturn[i] = mat.rows[i].elements;
			if (ma2 != null) {
				for (int i = mat.rows.length; i < toReturn.length; ++i)
					toReturn[i] = ma2.rows[i - mat.rows.length].elements;
			}
			return toReturn;
		} catch (Exception e) {
			e.printStackTrace();
		}
		return null;
	}

	/**
	 * Truy vấn các giá trị độ cao từ API Độ cao của Google cho các vị trí nhất
	 * định.
	 *
	 * @param places the location for which the elevations should be requested
	 * @return the elevation as double array, stable. May be null if request fails.
	 */
	public static double[] getElevations(LatLng[] places) {
		PendingResult<ElevationResult[]> pending = ElevationApi.getByPoints(context, places);
		try {
			return Arrays.stream(pending.await()).sequential().mapToDouble(r -> r.elevation).toArray();
		} catch (ApiException | IOException | InterruptedException e) {
			e.printStackTrace();
			return null;
		}
	}
}